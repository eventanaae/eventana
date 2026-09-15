/**
 * One-shot: email the Hatta festival games proposal to Adnan at Dubai Media
 * Incorporated, CC the owner + Marsha, with the proposal PDF attached and the
 * two package prices in the body. Gated SEND_ADNAN_PROPOSAL=true. Owner-approved
 * copy + design (2026-09-16). Turn the flag off after it sends.
 */
import { config } from '../config.js';
import { emailEnabled, sendEmail } from '../integrations/email.js';
import { HATTA_PDF_B64 } from './hattaPdfData.js';

const TO = 'Amarzouqi@dmi.ae';
const CC = ['sheem@eventanauae.com', 'marsha@eventanauae.com'];
const REPLY_TO = 'sheem@eventanauae.com';
const SUBJECT = "Kids' Game Show Proposal — Hatta Festival | Eventana";

function html(): string {
  const logo = config.emailLogoUrl;
  return `<!doctype html><html><body style="margin:0;background:#FBF3F7;font-family:'Segoe UI',Arial,sans-serif;color:#3B3641">
    <div style="max-width:600px;margin:0 auto;padding:26px 16px 36px">
      <div style="text-align:center;padding:14px 0 6px">
        ${logo ? `<img src="${logo}" alt="Eventana" style="height:58px;width:auto">` : `<span style="font-size:24px;font-weight:800;color:#E94F9C">Eventana</span>`}
      </div>
      <div style="text-align:center;font-size:11px;font-weight:700;letter-spacing:3px;color:#E94F9C;padding:0 0 18px">PROPOSAL &middot; DUBAI TV</div>
      <div style="background:#fff;border-radius:20px;padding:30px 28px;line-height:1.75;font-size:15px;box-shadow:0 10px 30px rgba(233,79,156,.08)">
        <p style="margin:0 0 16px">Dear Mr. Adnan Al Marzouqi,</p>
        <p style="margin:0 0 16px">We hope this message finds you well.</p>
        <p style="margin:0 0 16px"><b>Eventana</b> is pleased to present a proposal for a <b>heritage-inspired children's game show</b>, set in the spirit of the <b>Hatta Festival</b> &mdash; an entertaining, competitive program that blends fun, challenge, and teamwork through innovative games rooted in our local heritage, designed as a joyful experience for children and families.</p>
        <p style="margin:0 0 20px">Please find the <b>full proposal (PDF)</b> attached, including the concept and illustrative visuals for each of the <b>18 proposed games</b> with their details.</p>
        <div style="background:#FDEFF6;border:1px solid #f3dcea;border-radius:16px;padding:20px 22px;margin:0 0 20px">
          <div style="font-size:11px;font-weight:800;letter-spacing:2px;color:#E94F9C;margin-bottom:14px">PACKAGES</div>
          <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px">
            <div style="font-weight:700;font-size:15px">Package 1</div>
            <div style="font-weight:800;font-size:22px;color:#0E8E97;white-space:nowrap">AED 48,000</div>
          </div>
          <div style="font-size:13.5px;color:#7a6f77;margin:2px 0 16px">18 games &mdash; each played twice across 9 episodes (4 games per episode).</div>
          <div style="border-top:1px dashed #ecd3e2;padding-top:16px;display:flex;justify-content:space-between;align-items:baseline;gap:10px">
            <div style="font-weight:700;font-size:15px">Package 2</div>
            <div style="font-weight:800;font-size:22px;color:#0E8E97;white-space:nowrap">AED 35,000</div>
          </div>
          <div style="font-size:13.5px;color:#7a6f77;margin:2px 0 0">12 games &mdash; each played three times across 9 episodes (4 games per episode).</div>
          <div style="font-size:12.5px;color:#9a8f96;margin-top:16px;border-top:1px solid #f3e3ee;padding-top:12px">Both packages include the design, preparation, operation, and materials of the games. Pricing can be tailored to the production's requirements.</div>
        </div>
        <p style="margin:0 0 16px">We would be delighted to discuss the details and coordinate any additional requirements, and we look forward to collaborating on a memorable experience for our children.</p>
        <p style="margin:0 0 4px">Warm regards,</p>
        <p style="margin:0;font-weight:700">The Eventana Team</p>
      </div>
      <div style="text-align:center;color:#9a8f96;font-size:13px;padding:20px 10px 0;line-height:1.9">
        &#9993;&#65039; info@eventanauae.com &nbsp;&middot;&nbsp; &#128222; +971 56 450 0777 &nbsp;&middot;&nbsp; &#127760; eventanauae.com<br>
        <span style="color:#c2b6bd;font-size:11.5px">Eventana Events &middot; Dubai, UAE</span>
      </div>
    </div>
  </body></html>`;
}

export async function sendAdnanProposalFromEnv(): Promise<void> {
  if (String(process.env.SEND_ADNAN_PROPOSAL ?? '').toLowerCase() !== 'true') return;
  if (!emailEnabled()) { console.log('[adnan] email disabled — RESEND_API_KEY missing'); return; }
  const res = await sendEmail({
    to: TO, cc: CC, replyTo: REPLY_TO, subject: SUBJECT, html: html(),
    skipMonitorBcc: true,
    attachments: [{ filename: 'Eventana-Hatta-Proposal.pdf', content: HATTA_PDF_B64, contentType: 'application/pdf' }],
  });
  console.log(`[adnan] email to <${TO}> cc <${CC.join(', ')}> attach=${Math.round(HATTA_PDF_B64.length / 1024)}KB(b64): ${res.ok ? 'SENT id=' + res.id : 'FAILED ' + res.error}`);
}
