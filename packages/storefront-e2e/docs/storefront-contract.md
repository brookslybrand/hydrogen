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

Scope: the product, product variant, cart, and checkout groups use these IDs to find the product title, option values, and add to cart button. The cart and checkout groups also use the cart test IDs below. The collection, collection filter, and search groups use the product results test IDs below. The collection filter group also uses the collection filter test IDs, and the search group also uses the search test IDs. The suite still finds all other UI by role, label, and text, as the sections below describe. This includes the optional Apply filters button. The storefront can have other test IDs for its own tests. The suite does not read them.

## Cart Test IDs

The suite finds ten cart elements with standard `data-testid` attributes and Playwright `getByTestId`. The cart group uses the first nine. The checkout group uses `cart-drawer`, `cart-page`, `cart-line`, and `cart-checkout`. With the three product test IDs, the two product results test IDs, the two collection filter test IDs, and the two search test IDs, the suite reads 19 standard test IDs in total:

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

Collection and search pages must expose product cards as accessible links to product detail pages. The suite finds them with two standard `data-testid` attributes and Playwright `getByTestId`:

| Test ID | Put it on | Count | Evidence the suite reads |
| --- | --- | --- | --- |
| `product-results` | The existing element that holds the product results of a collection or search page, for example the grid list or its wrapper | Exactly one on the whole page | The suite finds product cards only inside it |
| `product-card` | The primary product link of each result: a native `<a>` with a real `href` to the product detail page, visible and exposed to assistive technology as a link whose accessible name contains the product title | One per rendered result, so the ID repeats | The `href`, visibility, the link role, and the accessible name |

A missing or duplicate `product-results` fails the test with a contract error. Inside the results, a visible `product-card` that is not a native `<a>`, or that has a missing, empty, or non-product `href`, also fails. In the collection and collection filter groups, results with no visible `product-card` link also fail. The search group accepts empty results (see Search). The suite reads and checks only visible cards. Hidden cards, such as responsive copies hidden with CSS or the `hidden` attribute, do not count and are not checked.

Rules:

- Put `product-results` on the main results only. Do not put it on recommendations, recently viewed products, featured or popular products, or predictive search results. Recommendations and these other lists can render their own product cards; the suite ignores cards outside `product-results`.
- On the search page, after a query, put `product-results` on the element that holds the results, and also on the existing element that shows the empty state when there are no results. Only one of the two renders at a time. Before a query, the page does not need the root. An empty root before the query is fine, but it must not contain visible `product-card` links.
- Put `product-card` on the primary `<a href>` product link of each result, not on the card wrapper, such as an `<article>` or list item. If a card has more than one link to the product, for example an image link and a title link, mark only one. The suite does not match the visible text, but the accessible name must contain the product title.
- Keep the link visible with its native link role. Do not hide it with `hidden` or `aria-hidden`, and do not override its role.
- Use existing elements. Do not add a wrapper, change the layout, or add test-only attributes for the suite. An element can have only one `data-testid`, so if the grid already has another test ID, put `product-results` on an existing parent of the grid.
- Like the other test IDs, these IDs do not add a server-rendering or hydration requirement.

Scope: the collection group finds the single `product-results` element, then the visible `product-card` link whose `href` path ends with `/products/:handle` for a product from the Storefront API. A path prefix, such as a locale, is allowed. It checks that the same link still has that path, then that it is exposed as a link whose accessible name contains the product title (case does not matter). A card for another product does not match, even when its title contains the requested title. The collection filter group counts the unique product URL paths of the visible `product-card` links inside `product-results`. The search group finds the card the same way for each searched product (see Search).

## Collection Filters

At least one probed collection must expose a visible, enabled checkbox filter that changes the URL, returns products, and reduces the visible product card count when selected. The suite finds filter values with two standard `data-testid` attributes and Playwright `getByTestId`:

| Test ID | Put it on | Count | Evidence the suite reads |
| --- | --- | --- | --- |
| `collection-filter-value` | Each filter value checkbox: the native `<input type="checkbox">` itself, exposed to assistive technology as a checkbox | One per rendered filter value, so the ID repeats, also in hidden copies such as a mobile drawer | The native checked state, enabled state, and the checkbox role |
| `collection-filter-label` | The visible native `<label>` that contains that checkbox | One for each `collection-filter-value`, in every copy | Its text content, where the first whole number in parentheses, such as `(4)` in `Red (4)`, is the count, and the click that selects the filter |

Placement: keep the checkbox inside its `<label>`, so the native label association pairs them. Do not point the label's `for` attribute at another element. Only list and boolean checkbox values get the IDs. Price inputs and the sort control do not.

The suite reads only visible labels, so hidden copies of the filters, such as a closed drawer, do not win. It checks the first 20 visible `collection-filter-label` elements before it chooses a filter. Each one must be a native `<label>` that contains exactly one `collection-filter-value` and is the native label of that checkbox. The checkbox must be a native `<input type="checkbox">` exposed as a checkbox. An inspected label that breaks one of these rules fails the test with a contract error, even when an earlier label is usable. Labels after the first 20 are not checked.

After the Storefront API discovery finds a collection with filters, these cases also fail with a contract error, not a skip:

- No visible `collection-filter-label` on the page.
- A different total number of `collection-filter-label` and `collection-filter-value` elements on the page, including hidden copies. For example, a marked checkbox whose label has no ID.

The suite cannot detect a filter value that has neither ID, and it does not read it. If the marked filters are valid but none has a count that narrows the results, the suite skips the test.

The suite clicks the label and expects the native checkbox to be checked. Filters can apply on change, as the reference storefronts do, so there is no test ID for an Apply button. A remaining semantic branch supports a storefront that needs one: after the click, the suite clicks a visible button whose accessible name contains Apply filters or Show results, if one exists.

Do not add test-only attributes for filter names, values, or state. The native `checked`, `name`, and `value` stay the source of truth.

The suite counts results as the unique product URL paths of the visible `product-card` links inside `product-results` (see Product Results). Product links outside the results, such as navigation or recommendations, do not count.

Filter labels must include a count like Red (4). The suite reads the text content of the `collection-filter-label`, removes a trailing " - Sold out", and uses the first whole number in parentheses as the count. It does not read counts from the `title` attribute, `aria-label`, or text such as `4 products`, so a label without a parenthesized number is not eligible. A value name that contains a number in parentheses, such as `Pack (2)`, comes first and can give the wrong count. This text dependency is temporary; the suite does not add custom attributes for counts. Known limitation: the React Router template color swatch labels show the count only as `4 products` text, so the suite does not choose swatches. The suite uses that count to choose a filter that narrows the visible product cards, then asserts the filtered result count does not exceed the label count. Browser Back after a filter selection must restore the previous URL and show the same filter, found by the same label text, unchecked. Missing Storefront API filter data skips the collection filter group.

When a probed collection exposes a Storefront API PRICE_RANGE filter, the page must render the price bounds as spinbuttons whose accessible names start with Minimum price and Maximum price. Typing a decimal bound such as 12.5 must put that exact value in the filter.v.price.gte or filter.v.price.lte URL param and keep it in the input. A storefront with no price range filter skips this check.

## Search

The search page form exposes its query input, and optionally its submit button, with two standard `data-testid` attributes:

| Test ID | Put it on | Count on the search page | Evidence the suite reads |
| --- | --- | --- | --- |
| `search-input` | The query input of the search page form, a native `<input type="search">` | Exactly one on the whole page | Visible, editable, and the searchbox role. The suite fills it with the product title |
| `search-submit` | Optional. The submit button of the same form, a native `<button>` | None, or exactly one on the whole page | Visible, the button role, a non-empty accessible name in any language, and the click |

Rules:

- Put `search-input` only on the search page input. Do not put it on a header search or predictive search input.
- Keep the input visible, enabled, and editable, as an `<input type="search">` that keeps its searchbox role. Do not hide it, make it read-only, or override its role.
- `search-submit` is optional. Without it, the suite presses Enter in `search-input`. With it, the suite clicks it instead. The button must be in the same form as `search-input` (`button.form` is the input's form), visible, and exposed as a button with a non-empty accessible name. The suite does not match the name text, so a name in any language works. A storefront without a search button, or with an unmarked one, is tested with Enter only, so the button click is not covered.
- A missing, duplicate, wrapper, hidden, or read-only `search-input`, or a duplicate, wrapper, hidden, unnamed, or other-form `search-submit`, fails the test with a contract error.
- The IDs only find the controls. The test passes only when the expected product link shows in the results, as described below.

The suite discovers live products with their handle and title from the Storefront API. For up to eight products, it opens the search page, fills `search-input` with the title, submits the search, and looks for that product in the results.

Before it fills the input, the suite requires that no visible `product-card` is inside `product-results`. This prevents an already-visible card from serving as search evidence. An empty `product-results` element before the query is fine. Visible marked cards inside that container before the query, for example featured or popular products marked as results, fail the test with a contract error. Keep featured, popular, and recent product lists outside `product-results`; their cards can still use `product-card`.

After each query, the page must render exactly one `product-results` element, for matching results and for empty results (see Product Results). A missing or duplicate root fails the test with a contract error. Inside it, the suite looks for the visible `product-card` link whose `href` path ends with `/products/:handle` for the searched product. It then checks that the link is exposed as a link whose accessible name contains the product title (case does not matter). A card for another product, such as `T-Shirt` for `Shirt`, does not match, and product links outside the results, such as recommendations, do not count.

If the results are empty or show only other products, the suite tries the next product. An invalid `product-card` in the results, or a matching card that is not an accessible link with the product title, fails the test with a contract error. It does not try the next product. If none of the eight products shows in its own results, the test fails.

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

The suite reads 19 standard test IDs: three for the product title, option values, and add to cart button, nine for the cart page, cart drawer, cart trigger, cart lines, cart line quantity and remove controls, and cart status, `cart-checkout` for the checkout link, `product-results` and `product-card` for collection and search product results, `collection-filter-value` and `collection-filter-label` for collection filter checkboxes, and `search-input` and `search-submit` for the search page form. The collection, collection filter, and search groups use `product-results` and `product-card`. The search group also uses `search-input` and the optional `search-submit`. The collection filter group also uses `collection-filter-value` and `collection-filter-label`. The checkout group uses `cart-drawer`, `cart-page`, `cart-line`, and `cart-checkout`. The suite finds all other UI by semantic roles and label strings. It still matches the English cart totals status text inside `cart-status`. Before the suite reads a new test ID, add it to this document.
