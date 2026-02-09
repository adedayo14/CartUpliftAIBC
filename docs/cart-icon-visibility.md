# Cart Icon Visibility & Native Drawer Blocking Fix

## Issue 1: Cart Icon Disappearing

### Symptom
- When the Cart Uplift embed block loaded on certain themes, the native header cart icon disappeared.
- Merchants still saw their cart count update, but the clickable icon was removed, preventing shoppers from opening the drawer.

### Root Cause
- The legacy suppression CSS in `cart-uplift-v2.js` hid whole `.cart-drawer` elements to prevent theme drawers from stacking on top of Cart Uplift.
- Several themes (including Dawn derivatives) mount the header icon inside the same `cart-drawer` container, so hiding the wrapper removed the icon as well.

### Resolution
- Narrowed the suppression selectors to only target the inner drawer content (`.drawer__inner`, `.cart-drawer__contents`, overlays, etc.) while leaving the outer `cart-drawer` host element visible.
- Added safeguards that keep header cart icons visible and interactive, even when the theme uses the `<cart-icon>` web component.

## Issue 2: Native Shopify Cart Drawer Still Opening

### Symptom
- When clicking the cart icon, both the native Shopify cart drawer AND the Cart Uplift drawer would open simultaneously.
- This created a confusing experience where two carts appeared on screen.

### Root Cause
- Theme scripts were running before Cart Uplift's interception logic could block them.
- The `preventThemeCartUplift()` method was being called after theme handlers were already registered.
- No global CSS rule to force-hide the native drawer element itself.

### Resolution
1. **Immediate Global Interception**: Added a blocking script that runs BEFORE any theme scripts in `app-embed.liquid`. This intercepts ALL cart clicks at the capture phase before theme handlers can process them.

2. **Comprehensive Selector Blocking**: Expanded the `preventThemeCartUplift()` method to intercept:
   - Cart links (`a[href="/cart"]`)
   - Cart icon elements (`.cart-icon`, `cart-icon`, `.header__icon--cart`)
   - Data attributes (`[data-cart-drawer-toggle]`, `[data-cart-trigger]`)
   - Custom events (`cart:open`, `drawer:open`, etc.)
   - Keyboard activation (Enter/Space keys)
   - Web components (`<cart-icon>`)

3. **Force CSS Hiding**: Added aggressive CSS rules that force-hide the native cart drawer element itself:
   ```css
   cart-drawer:not(#cartuplift-cart-popup),
   #CartDrawer:not(#cartuplift-cart-popup),
   details.cart-drawer[open] {
     display: none !important;
     visibility: hidden !important;
   }
   ```

4. **Ready Event**: Added a `cartuplift:ready` event that fires when the drawer is initialized, allowing queued cart opens to execute once the drawer is available.

## Technical Implementation

### Files Modified
- `extensions/cart-uplift/assets/cart-uplift-v2.js`
  - Enhanced `preventThemeCartUplift()` with comprehensive trigger interception
  - Added CSS rules to force-hide native drawer
  - Added `cartuplift:ready` event dispatch
  
- `extensions/cart-uplift/blocks/app-embed.liquid`
  - Added immediate global cart interception script (runs before theme scripts)
  - Blocks clicks, keyboard events, and custom events at capture phase
  
- `extensions/cart-uplift/assets/cart-bundles.js`
  - Added initialization guard to prevent duplicate execution
  
- `extensions/cart-uplift/blocks/smart-bundles.liquid`
  - Removed direct script include (now lazy-loaded)

### Key Techniques
- **Capture Phase Event Handling**: Uses `addEventListener(..., true)` to intercept events before they bubble to theme handlers
- **Event Suppression**: Calls `preventDefault()`, `stopPropagation()`, and `stopImmediatePropagation()` to completely block native behavior
- **CSS Specificity**: Uses `!important` rules with high specificity to override theme styles
- **Mutation Observer**: Watches for dynamically added cart elements and attaches interceptors
- **Lazy Loading**: Bundle script only loads when FBT widgets are present on the page

## Validation Steps
1. Enable the Cart Uplift app embed on a storefront running Dawn or similar theme
2. Reload the page; verify the header cart icon renders correctly
3. Click the cart icon and confirm ONLY the Cart Uplift drawer opens (no native drawer)
4. Add an item to cart and verify auto-open behavior works correctly
5. Test keyboard navigation (Tab + Enter on cart icon)
6. Verify other drawers (search, menu) still work normally

## Bundle Script Clarification
The project has two separate JavaScript files:
- `cart-uplift-v2.js` - Main cart drawer functionality (the "v2" is just a version marker)
- `cart-bundles.js` - Separate FBT (Frequently Bought Together) widget

These are intentionally separate files:
- Main script loads on all pages for cart functionality
- Bundle script only loads when FBT widgets are present (performance optimization)
- No duplication - they serve different purposes
