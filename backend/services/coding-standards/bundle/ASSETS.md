# Interface and asset integrity

Apply to user-facing interfaces, generated exports, and brand assets.

- Reuse the project's canonical assets, components, and design tokens. Use supplied logos; do not redraw, substitute, distort, crop, recolor, or add a background without a design requirement.
- Keep vector/original sources and derive consumer sizes from them. Verify resolution, aspect ratio, transparency, and actual rendering at the intended size.
- Check loading, empty, error, success, keyboard, and supported viewport states. Test connected behavior, not only whether a component renders.
- Keep downloads and static exports consistent with the current source; regenerate and inspect them when their content changes.
- Keep implementation details out of product flows unless they help the user make a decision. Value-moving interfaces also follow [FUND_FLOW_PROOF.md](./FUND_FLOW_PROOF.md).
