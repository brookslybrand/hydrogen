# Storefront E2E Contract

This package runs one Playwright suite against an already-running storefront. It uses live data only. It does not start a server, set environment variables, or mock Storefront API responses.

The runtime source of truth for test group prerequisites lives in specs/*/config.ts. Shared route and GraphQL validation lives in src/spec-config-validation.ts. Domain-specific setup and probes stay inline in the config or spec file that uses them. Error formatting lives in src/contract.ts; domain-specific messages live near the matcher or spec. This document explains the same contract for humans.

The suite uses a tokenless Hydrogen Storefront API client for read-only discovery. Discovery uses the Storefront API version bundled with Hydrogen. Storefront API failures stop the affected test group instead of falling back to DOM-only discovery. Cart and checkout discovery ignore subscription-only products and prefer variants that are available for sale.

Each test group validates its own prerequisites in config.ts before any test runs. Required product, cart, and checkout prerequisites fail their test group with an actionable message. Optional collection, collection filter, search, and product variant prerequisites skip their group when the storefront data or route is unavailable.

## Routes

The tested storefront must expose the routes required by each active test group. Route checks use a bounded fetch before the browser test runs so missing routes fail or skip with setup context instead of timing out deep in the test.

Default route expectations:

- /cart is required for default cart and checkout tests
- Product detail routes at /products/:handle are required for default product, cart, and checkout tests
- /collections/:handle is required for collection tests when a collection with products exists
- /search is required for search tests when in-stock products exist

Required groups fail on route HTTP failures; optional groups skip.

## Product Test IDs

The suite finds three product detail elements with standard `data-testid` attributes and Playwright `getByTestId`:

| Test ID | Put it on | Count on the product page | Evidence the suite reads |
| --- | --- | --- | --- |
| `product-title` | The product heading, a native `<h1>` | Exactly one | A visible level-one heading exposed to assistive technology, whose text contains the product title (case does not matter) |
| `product-option-value` | Each option value control: the native `<a>` or `<button>` itself, not a wrapper | One per rendered option value, so the ID repeats | Accessible name, `href`, `aria-current`, `aria-pressed`, and disabled state |
| `product-add-to-cart` | The add to cart control, a native `<button>` | Exactly one on the whole page | Enabled or disabled state, and the click |

Exactly one means the whole page. If recommendations, a sticky bar, or a quick-add form render another title or add to cart button, do not give it the same test ID. A missing or duplicate `product-title` or `product-add-to-cart` fails the test with a contract error.

Rules:

- Put each ID on the element a buyer reads or activates. Do not put it on a container.
- A test ID only identifies a kind of element. Do not add new test-only attributes for the suite, such as option names, values, variant IDs, or selected state. Existing app attributes, such as `data-*` used for styling, can stay.
- State comes from native attributes and ARIA:
  - Option links: `aria-current="true"` on the selected link.
  - Option buttons: `aria-pressed`, with `aria-pressed="true"` on the selected button.
  - Option values for combinations that do not exist: buttons with the native `disabled` attribute.
  - Add to cart: native `disabled` or `aria-disabled="true"` when the selection cannot be added. Keep the storefront's existing interaction behavior. For example, a button with `aria-disabled="true"` can still move focus to the first option on click.
- Test IDs do not replace accessibility. The title stays the page heading, each control keeps an accessible name, and state stays in the attributes above.
- The test IDs do not add a server-rendering or hydration requirement. They go on the same elements the page already renders. Where the page supports server rendering and no-JavaScript selection, the IDs are on the server-rendered elements.

Scope: the product, product variant, cart, and checkout groups use these IDs to find the product title, option values, and add to cart button. The cart and checkout groups also use the cart test IDs below. The suite still finds all other UI by role, label, and text, as the sections below describe. This includes product results, collection filters, and search. The storefront can have other test IDs for its own tests. The suite does not read them.

## Cart Test IDs

The suite finds ten cart elements with standard `data-testid` attributes and Playwright `getByTestId`. The cart group uses the first nine. The checkout group uses `cart-drawer`, `cart-page`, `cart-line`, and `cart-checkout`. With the three product test IDs, the suite reads 13 standard test IDs in total:

| Test ID | Put it on | Count | Evidence the suite reads |
| --- | --- | --- | --- |
| `cart-page` | The content root of the `/cart` page, for example its `<main>` | Exactly one on the cart page | The suite finds cart page lines inside it |
| `cart-drawer` | The cart drawer, a native `<dialog>` | Exactly one on the whole page | The suite finds the added line inside it after Add to cart |
| `cart-trigger` | The control that opens the cart drawer, a native `<button>` or a native `<a>` that opens the drawer when clicked | Exactly one on the whole page when the suite uses it | The click |
| `cart-line` | Each rendered cart line: the element that holds the line's product title, variant text, and line controls | One per rendered line, so the ID repeats. The cart page and the drawer each have their own lines | The product title and variant text, and the line controls inside it |
| `cart-line-quantity` | The editable quantity input of each line, a native `<input>` (for example `type="text"` or `type="number"`) | Exactly one in each line | The native input value, which the suite fills and reads as the quantity |
| `cart-line-increase` | The increase quantity control of each line, a native `<button>` | Exactly one in each line | The click |
| `cart-line-decrease` | The decrease quantity control of each line, a native `<button>` | Exactly one in each line | The click |
| `cart-line-remove` | The remove control of each line, a native `<button>` | Exactly one in each line | The click, after which the line must go away |
| `cart-status` | The existing cart totals live region, the element with `role="status"` | At least one on the page. It can repeat, for example in the cart page, in the drawer, or once for the whole page | Its text, which must contain the English status message (see Cart Line Items) |
| `cart-checkout` | The checkout link of each populated cart view: a native `<a>` with a real `href` to the checkout URL, visible and exposed to assistive technology as a link with a non-empty accessible name in any language | One per populated cart view, so it can repeat in the cart page and the drawer. Exactly one inside the cart page | The `href`, the link role and accessible name, and the click, on the cart page link only |

A missing or duplicate `cart-page`, `cart-drawer`, or `cart-trigger` fails the test with a contract error. A missing `cart-status` with the expected text also fails. A missing or duplicate `cart-checkout` inside the cart page also fails. So does one that is not a native `<a>`, has a missing or non-checkout `href`, or is not a visible link with a non-empty accessible name. A `cart-drawer` that is not a native `<dialog>`, or a `cart-trigger` that is not a native `<button>` or `<a>`, also fails.

Rules:

- Keep the drawer outside the `cart-page` element. The drawer can stay in the page on `/cart`. The `cart-page` ID keeps the two cart views apart.
- The stock-limit rollback test reads the native `open` state of the drawer `<dialog>` while its mutation request is held. If the drawer is closed, it clicks `cart-trigger`, then waits for the line. The closed dialog must already be rendered before that click; its lines can render only when it opens. Ordinary add-to-cart setup does not use this trigger fallback.
- The suite finds a line by `cart-line` inside the cart page or inside the drawer, never across both. In that view, exactly one `cart-line` must contain the product title. No match, or more than one match, fails with a contract error. The same product can have one line in the page and one in the drawer.
- Put `cart-line` on one element per line that contains the line's title, variant text, quantity input, and line controls. Do not nest it, and do not put it on other list items, such as recommendations. Any element works; the ID does not add an HTML tag requirement.
- Put `cart-trigger` only on a control that opens the drawer. A link that only goes to `/cart`, for example a fallback link before hydration or on the cart page, is not a trigger. Do not give it the ID.
- Do not add new test-only attributes for the suite. State and accessible names stay in native attributes and ARIA, for example `aria-controls`, `aria-haspopup`, and `aria-expanded` on the trigger. Existing app attributes can stay.
- The suite finds `cart-line-quantity`, `cart-line-increase`, `cart-line-decrease`, and `cart-line-remove` only inside the selected `cart-line`. Each one must be the single visible native element of its kind in that line. A missing, duplicate, hidden, or non-native target fails with a contract error. Controls in other lines do not count.
- The native input value is the quantity. Do not add test-only attributes for the quantity or for pending state. Keep the existing native `disabled` state and accessible names on the buttons, including the remove button.
- Put `cart-status` on the existing status region that announces cart totals updates. Do not move, duplicate, or restyle the region for the suite. A region outside both the cart page and the drawer is fine.
- The suite waits until at least one element has `cart-status`, is exposed to assistive technology with `role="status"`, and contains the expected text. It does not need exactly one, and it does not pick a view. An element with the ID but without `role="status"`, or a region hidden with `aria-hidden`, does not count. A status region without the ID does not count.
- Put `cart-checkout` on the native `<a href>` checkout link of each populated cart view. Do not put it on a disabled placeholder, such as a `<span>` with `aria-disabled` when the cart cannot check out, or on payment buttons such as Shop Pay. The link must be visible and keep its native link role and a non-empty accessible name. Do not hide it with `hidden` or `aria-hidden`, and do not override its role, for example with `role="button"`. The suite does not match the name text, so a name in any language works.
- The suite finds `cart-checkout` only inside `cart-page` and clicks only that link. A checkout link in the drawer, open or closed, does not count.
- Like the product test IDs, these IDs do not add a server-rendering or hydration requirement.

Scope: the cart group uses these IDs only to find the cart page, the cart drawer, the trigger, the cart lines, the line quantity and remove controls, and the cart totals status. It finds the quantity input and the increase, decrease, and remove buttons by test ID inside the line. It finds the totals status by test ID and `role="status"`, then matches its English text. The checkout group uses only `cart-drawer`, `cart-page`, `cart-line`, and `cart-checkout`. After Add to cart, it waits for exactly one matching line in the drawer. On the cart page, it requires exactly one matching line that shows the variant text, then the single `cart-checkout` link inside the cart page. It does not use `cart-trigger`, the line quantity and remove IDs, or `cart-status`.

## Product Results

Collection and search pages must expose product cards as accessible links to product detail pages.

Discovery uses link roles, label strings, and link paths.

## Collection Filters

At least one probed collection must expose a visible, enabled checkbox filter that changes the URL, returns products, and reduces the visible product-link count when selected. Filters may auto-submit or use a visible Apply filters/Show results button.

Filter labels must include a count like Color Red (4). The suite uses that count to choose a filter that narrows the visible product links, then asserts the filtered result count does not exceed the label count. Browser Back after a filter selection must restore the previous URL and show the same filter unchecked. Missing Storefront API filter data skips the collection filter group.

When a probed collection exposes a Storefront API PRICE_RANGE filter, the page must render the price bounds as spinbuttons whose accessible names start with Minimum price and Maximum price. Typing a decimal bound such as 12.5 must put that exact value in the filter.v.price.gte or filter.v.price.lte URL param and keep it in the input. A storefront with no price range filter skips this check.

## Search

The search page must expose a searchbox. A visible button with an accessible name containing Search is supported; otherwise the suite submits the searchbox with Enter.

The suite discovers a live product title, searches for it, and verifies that product appears in visible results.

## Variant Options

At least one probed product must expose a selectable variant control. Each control has `data-testid="product-option-value"` (see Product Test IDs). The product heading has `data-testid="product-title"`.

Supported controls:

- Same-product links whose href is a product URL with selected option query params. The selected link has `aria-current="true"`.
- Buttons with `aria-pressed`. The selected button has `aria-pressed="true"`. Buttons work only with JavaScript; the no-JavaScript check needs links.
- If the page renders option combinations that do not exist, render them as buttons with the native `disabled` attribute. They keep the test ID. The suite does not select disabled controls.

With JavaScript, selecting a value must put the selection in the URL (for a link, the link's href) and mark the value as selected. Loading that URL directly must render the product title and show the same value as selected. Selection must keep unrelated non-option query params (the suite uses `storefront_e2e_ref=variant-check`).

Without JavaScript, the product title must render, and at least one probed product must expose a same-product variant link for an unselected value. A native click on that link must load its href, keep unrelated query params, and the server-rendered page must mark that value as selected.

Selected values should also be visibly indicated (styling or text). The suite does not check this. It also does not check that hydration is complete before it clicks, how many navigations or document loads a selection makes, or the visible appearance, price, or merchandise of the selected variant.

Set STOREFRONT_SKIP_NO_JS_VARIANTS=true to skip the no-JavaScript check for a storefront that cannot render the product page without JavaScript or does not render variant links. A skip is an expected opt-out, not a pass. The Next.js template sets it in CI because its product content streams behind a Suspense fallback.

## Cart Line Items

In the cart and checkout groups, each cart line is a visible element with `data-testid="cart-line"` that contains the product title (see Cart Test IDs).

The cart and checkout groups add a product with the single button that has `data-testid="product-add-to-cart"` (see Product Test IDs). The button must be enabled for the discovered variant. It keeps an accessible name, such as Add to cart.

After ordinary Add to cart, the drawer must open automatically and show the added line before the suite navigates to the cart page. Only the stock-limit rollback test uses `cart-trigger` to open a closed drawer while the mutation request is held. On the cart page, the suite finds lines inside `data-testid="cart-page"`. In both views, it finds the line with `data-testid="cart-line"`. See Cart Test IDs.

Each line must expose:

- Variant text when the product has a non-default variant
- A visible quantity input with `data-testid="cart-line-quantity"`
- A visible increase button with `data-testid="cart-line-increase"`
- A visible decrease button with `data-testid="cart-line-decrease"`
- A visible remove button with `data-testid="cart-line-remove"`

The increase, decrease, and remove buttons keep an accessible name, but the suite does not match their name. It reads the quantity result from the native value of the quantity input. After remove, it waits for the line to go away.

Cart totals must expose a `role="status"` region with `data-testid="cart-status"` that says `Updating cart totals` while cart totals are stale, then `Cart totals updated` after mutation settlement. Do not announce `Cart totals updated` on initial idle render before a mutation cycle. The region may be visually hidden if it remains available to assistive technology.

The suite finds the totals status anywhere on the page by `data-testid="cart-status"` and `role="status"`, then matches the English text. The English text is a known dependency: a storefront in another language must still render these English messages in the status region. A language-independent status signal is deferred and is not part of this contract.

## Checkout Handoff

The checkout test verifies only the storefront-owned side of the checkout handoff.

It verifies the added product and variant in the storefront cart, clicks the visible checkout link, and waits for a checkout URL. It finds the added line in the drawer and on the cart page with `cart-drawer`, `cart-page`, and `cart-line` (see Cart Test IDs). It finds the checkout link by `data-testid="cart-checkout"` inside the cart page and checks that its `href` targets a checkout URL. Then it checks that the link is visible and exposed to assistive technology as a link with a non-empty accessible name. It does not match the name text. It does not depend on the external checkout document loading, enter customer data, payment data, or perform any irreversible checkout step.

If the storefront does not start checkout navigation, the test fails as a contract issue. External checkout availability is outside this suite's boundary.

## Operations

Run with:

STOREFRONT_BASE_URL=https://your-storefront.example pnpm test:e2e:storefront

Set STOREFRONT_E2E_WORKERS to override the default parallel worker count.
The worker override must be an integer from 1 to 12.

Operational expectations:

- Use a development or example storefront, not a production merchant storefront unless explicitly accepted.
- The owner of STOREFRONT_BASE_URL is responsible for health, live data, cart, and checkout availability.
- Playwright runs headless and fully parallel by default.
- Artifacts are failure-only.
- If CI wiring is added, artifact upload must set explicit retention-days.
- Unit tests intentionally do not enforce coverage thresholds because this package's behavioral coverage is the live storefront contract suite. Add thresholds if non-e2e unit coverage becomes a quality signal for package code.

## Contract Migration

When the storefront contract changes, update the relevant spec matcher, shared helper, and this document together.

The suite reads 13 standard test IDs: three for the product title, option values, and add to cart button, nine for the cart page, cart drawer, cart trigger, cart lines, cart line quantity and remove controls, and cart status, and `cart-checkout` for the checkout link. The checkout group uses `cart-drawer`, `cart-page`, `cart-line`, and `cart-checkout`. The suite finds all other UI by semantic roles and label strings. It still matches the English cart totals status text inside `cart-status`. Before the suite reads a new test ID, add it to this document.
