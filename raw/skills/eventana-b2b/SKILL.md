---
name: eventana-b2b
description: Eventana new-client acquisition and corporate contracts — finds companies, schools and clubs, drafts first-touch outreach, follows replies, and prepares proposals and contracts. Use for corporate/B2B leads, school or company events, or a corporate proposal.
---

# جلب العملاء وعقود الشركات

Read `eventana-team` first.

## What exists
- `apps/api/src/domain/corporateOutreach.ts` + table `corporate_leads`: collects B2B
  leads by category/emirate from Google Places (`CORP_COLLECT=on` + key — whether it is on
  in production is unknown: check first), first-touch email per category
  (`buildFirstTouchBody`), reply processing and a suggested reply. UI in Ops → Marketing.
- Collateral: `design/Eventana-Corporate-Profile.pdf`, `design/corporate-profile.md`,
  `apps/customer/public/company-profile.html`; landing page `corporate-events`.

## Missing (build as drafts for the owner)
- Proposal template (Arabic + English), corporate price tiers, contract template
  (scope, date, deposit, cancellation per our refund rules, liability). Prices only from
  the live catalogue — never invent.

## Weekly
Pipeline in the log: new prospects, emails ready to send, replies, meetings, proposals out.
Outreach emails go out only after the owner approves the template (via the secretary).
