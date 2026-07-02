// supabase/functions/send-digest/index.ts
//
// Deploy with: supabase functions deploy send-digest
// Required secrets (set via `supabase secrets set` or the dashboard):
//   RESEND_API_KEY
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically
// by the Supabase runtime — do not set these yourself.
//
// Call with { subject, intro, image_ids, preview: true } to get back
// { html } without sending anything or touching the database.
// Call without `preview` to actually send to all active subscribers.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY   = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FROM_ADDRESS      = "molly <hi@mollybakerragan.com>"; // ← update once your domain is verified in Resend
const SITE_BASE_URL     = "https://mollybakerragan.com";   // ← update to your real domain

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { subject, intro, image_ids = [], external_ids = [], preview } = await req.json();

if (!subject || (image_ids.length === 0 && external_ids.length === 0)) {
  return new Response(JSON.stringify({ error: "Missing subject, or no images selected" }), {
    status: 400,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function reorderByIds(rows: any[], ids: string[]) {
  const byId = new Map(rows.map(r => [String(r.id), r]));
  return ids.map(id => byId.get(String(id))).filter(Boolean);
}

let mainImages: any[] = [];
if (image_ids.length) {
  const { data, error } = await supabase
    .from("images")
    .select("id, url, caption, project")
    .in("id", image_ids);
  if (error) throw error;
  mainImages = reorderByIds(data, image_ids);
}

let externalImages: any[] = [];
if (external_ids.length) {
  const { data, error } = await supabase
    .from("external_images")
    .select("id, url, caption, source")
    .in("id", external_ids);
  if (error) throw error;
  externalImages = reorderByIds(data.map(r => ({ ...r, project: r.source })), external_ids);
}

const images = [...mainImages, ...externalImages];

    // ── THE ONE AND ONLY EMAIL TEMPLATE ──
    // Edit this function to change how the newsletter looks. Both the
    // admin panel's Preview button and the real send call this exact code.
    const PROJECT_TITLES: Record<string, string> = {
  zines: "zines ive made",
  whatdoyousee: "what do you see?",
  unlearning: "unlearning library",
  bioephemera: "leaves n things ive stashed in my books",
  unsubscribe: "newsletters ive unsubscribed from",
  headphones: "times ive untangled my headphones",
  trees: "street trees ive met",
  memes: "memes ive saved",
  cables: "dead internet cables ive cut out of street trees",
  selfies: "self-reflection",
};

function buildHtml(unsubscribeUrl: string) {
  const byProject: Record<string, typeof images> = {};
  for (const img of images) {
    if (!byProject[img.project]) byProject[img.project] = [];
    byProject[img.project].push(img);
  }

  // Shuffle project order so the digest doesn't always lead with the same
  // section — uses a Fisher-Yates shuffle for an unbiased random order.
  const projectEntries = Object.entries(byProject);
  for (let i = projectEntries.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [projectEntries[i], projectEntries[j]] = [projectEntries[j], projectEntries[i]];
  }

  let html = `<div style="font-family:sans-serif;width:100%;max-width:600px;margin:0 auto;color:#000;">`;
  html += `<h2 style="font-weight:400;font-size:18px;text-align:center;">${subject}</h2>`;
  if (intro) html += `<p style="font-size:14px;line-height:1.6;">${intro}</p>`;

  for (const [project, projImages] of projectEntries) {
    const title = PROJECT_TITLES[project] || project;

    html += `<h3 style="font-weight:600;font-size:15px;margin:32px 0 12px;text-align:center;color:#000;">${title}</h3>`;

    if (project === 'memes') {
      // True masonry via column round-robin: each column is its own <td>
      // stacked vertically, so varying image heights naturally produce a
      // masonry look without relying on CSS grid/columns (unsupported in
      // Outlook desktop and several other email clients).
      const MAX_COLS = 3;
      const COLS = Math.min(MAX_COLS, projImages.length);
      const columns: any[][] = Array.from({ length: COLS }, () => []);
      projImages.forEach((img, idx) => columns[idx % COLS].push(img));

      const tablePercent = ((COLS / MAX_COLS) * 100).toFixed(2);
      const colPercent = (100 / COLS).toFixed(2);

      html += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr><td align="center" style="padding:0;">`;
      html += `<table role="presentation" width="${tablePercent}%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;max-width:100%;">`;
      html += `<tr>`;
      for (const col of columns) {
        html += `<td width="${colPercent}%" valign="top" style="padding:0;">`;
        for (const img of col) {
          html += `<img src="${img.url}" width="100%" style="display:block;width:100%;height:auto;">`;
        }
        html += `</td>`;
      }
      html += `</tr></table>`;
      html += `</td></tr></table>`;
    } else {
      const MAX_COLS = 3;
      for (let i = 0; i < projImages.length; i += MAX_COLS) {
        const rowImages = projImages.slice(i, i + MAX_COLS);
        const rowPercent = ((rowImages.length / MAX_COLS) * 100).toFixed(2);
        const cellPercent = (100 / rowImages.length).toFixed(2);

        // Outer full-width table centers the (possibly narrower) row table
        // inside it via align="center" — this works even for percentage
        // widths, unlike margin:auto on a fixed-px table.
        html += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr><td align="center" style="padding:0;">`;
        html += `<table role="presentation" width="${rowPercent}%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;max-width:100%;">`;
        html += `<tr>`;
        for (const img of rowImages) {
          html += `<td width="${cellPercent}%" valign="top" style="padding:0;">`;
          html += `<img src="${img.url}" width="100%" style="display:block;width:100%;height:auto;border-radius:0px;">`;
          if (img.caption) {
            const captionHtml = img.caption
              .replace(/\\n/g, "<br>")
              .replace(/\r?\n/g, "<br>");
            html += `<p style="font-size:11px;text-align:center;opacity:0.7;margin:4px 5px 8px;line-height:1.5;">${captionHtml}</p>`;
          }
          html += `</td>`;
        }
        html += `</tr></table>`;
        html += `</td></tr></table>`;
      }
    }
  }
  html += `<p style="font-size:11px;opacity:0.5;margin-top:32px;text-align:center;">you subscribed to this at some point on <a href="${SITE_BASE_URL}" style="color:inherit;">mollybakerragan.com.</a> <br><br> <a href="${unsubscribeUrl}" style="color:inherit;">unsubscribe here</a></p>`;
  html += `</div>`;
  return html;
}

    // ── PREVIEW MODE: render and return, do nothing else ──
    if (preview) {
      return new Response(JSON.stringify({ html: buildHtml("#") }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── everything below only runs for a real send ──

    // 1. Create the digest record
    const { data: digest, error: digestErr } = await supabase
      .from("digests")
      .insert([{ subject, intro: intro || null, sent_at: new Date().toISOString() }])
      .select()
      .single();
    if (digestErr) throw digestErr;

    // 2. Mark these images as belonging to this digest (both tables)
    if (image_ids.length) {
      const { error: assignErr } = await supabase
        .from("images")
        .update({ digest_id: digest.id })
        .in("id", image_ids);
      if (assignErr) throw assignErr;
    }
    if (external_ids.length) {
      const { error: assignExtErr } = await supabase
        .from("external_images")
        .update({ digest_id: digest.id })
        .in("id", external_ids);
      if (assignExtErr) throw assignExtErr;
    }

    // 3. Fetch active subscribers
    const { data: subscribers, error: subErr } = await supabase
      .from("subscribers")
      .select("email, unsubscribe_token")
      .is("unsubscribed_at", null);
    if (subErr) throw subErr;

    if (!subscribers || subscribers.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0, note: "No active subscribers." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4. Send one email per subscriber via Resend
    let sent = 0, failed = 0;
    for (const sub of subscribers) {
      const unsubscribeUrl = `${SITE_BASE_URL}/unsubscribe.html?token=${sub.unsubscribe_token}`;
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: FROM_ADDRESS,
            to: sub.email,
            subject,
            html: buildHtml(unsubscribeUrl),
          }),
        });
        if (res.ok) sent++; else failed++;
      } catch {
        failed++;
      }
    }

    return new Response(JSON.stringify({ ok: true, sent, failed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});