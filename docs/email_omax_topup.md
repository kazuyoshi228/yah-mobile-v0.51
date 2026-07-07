# Email to OMAX — Japan top-up (recharge) plans & top-up on depleted eSIMs

_Draft (English). Adjust greeting/recipient/signature before sending._

---

**Subject:** Japan top-up (recharge) plan IDs + top-up behavior when data reaches 0

Hello OMAX team,

We sell eSIMs for travelers to Japan and integrate with the Bappy API
(`https://api.omaxtelecom.com/bappy/v1`). We currently use:

- `GET /plans` — to list available plans
- `PUT /links/{identifier}/plans` with body `{ "add": ["<plan-id>"] }` — to add a plan to an existing eSIM
- `GET /links/{identifier}` — to read the link's activations and remaining data

We are enabling **top-up (recharge)** so that a customer whose data has run out
can buy more data on the **same** eSIM. We have two requests.

## 1. Please provide the current top-up (recharge) plan IDs for Japan

We need to register the correct plans in our system with local (JPY) pricing.
Could you send us the list of **Japan-coverage** top-up/recharge plans you want
us to sell, including for each plan:

- Plan **ID** (the exact value we pass to `PUT /links/{identifier}/plans`)
- Data volume and validity (days)
- Partner cost / currency
- Whether it is intended as a **top-up/recharge** plan (added to an existing
  link) vs. an **initial** plan (new eSIM issuance)

We currently discover plans via `GET /plans` and filter by
`coverage.countries` containing `"JP"`. If top-up plans are **not** distinguished
from initial plans in that response, please tell us how to tell them apart.

## 2. IMPORTANT — top-up cannot be applied once data reaches 0

The moment a customer wants to top up is exactly when their data has been fully
consumed. However, **when an eSIM's remaining data reaches 0, we are unable to
pick up / apply a top-up plan to that link.** This blocks the entire top-up use
case for us.

Please clarify the correct behavior and flow:

- Is `PUT /bappy/v1/links/{identifier}/plans` with `{ "add": ["<plan-id>"] }`
  the correct and current method to add a recharge plan to an **already-activated**
  eSIM?
- Does this operation work when the link's **remaining data is 0** (and while the
  link has **not yet expired**)? In our data we see a link in `status: active`
  with `data_remaining_mb ≈ 0` and a future `expiry_date` — can such a link be
  topped up?
- If a depleted link **cannot** be topped up directly, what is the correct flow to
  recharge it (e.g., a specific endpoint, a required state, or a different plan
  type)?
- After a successful top-up, will `GET /links/{identifier}` reflect the added data
  (`data_remaining_mb` / `data_used_mb`) and a new active activation, so we can
  confirm the recharge programmatically?

A concrete example / test link ID from our account can be provided on request so
you can reproduce the behavior.

Thank you very much for your help. Once we have the Japan top-up plan IDs and a
confirmed recharge flow (including the data-at-0 case), we can enable top-up for
our customers.

Best regards,
yah.mobile team
