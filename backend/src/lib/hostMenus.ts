/**
 * basil-14648 P2 (host menus): rsv's own switch, PIZZA_HOST_MENUS=1 (unset = off: no route, no UI).
 *
 * Whether a given shop takes a host menu is pizza-mcp's answer on the shop itself,
 * `capabilities.host_menu_upload` (HOST_MENUS on there, a listing shop, not opted out): the UI offers the feature
 * only for those shops, and pizza-mcp refuses the rest anyway.
 */
export function hostMenusFlagOn(): boolean {
  return process.env.PIZZA_HOST_MENUS === '1';
}
