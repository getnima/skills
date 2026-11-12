/**
 * Avatar system: one import for the rest of the client. See ./README.md.
 * The dressing room is NOT exported here on purpose: load it lazily with import('./dressing').
 */
export * from '../../../shared/avatar';
export { Avatar, useAvatarUrl } from './Avatar';
export type { AvatarProps } from './Avatar';
export {
  AVATAR_BGS, BASE_ITEMS, CATALOG_PROBLEMS, COMBOS, DEFAULT_TOWER, DOLL, GENERIC_LINES, ITEMS, ITEM_IDS, LAYER_ORDER,
  canCarry, canStack, comboFor, getBg, getItem, itemAr, itemsOfSlot, linesFor, normalizeLook, plateColor, tapItem,
} from './catalog';
export type { AvatarBg, AvatarBgKind, AvatarCombo, AvatarFly, AvatarItem, AvatarSnd, AvatarTower } from './catalog';
export {
  AVATAR_BUCKETS, AVATAR_CACHE_MAX, AVATAR_URL_MAX, avatarBitmap, avatarBucket, avatarCacheStats, avatarCanvas, avatarUrl, clearAvatarCache,
  composeAvatar, drawPlate, holdAvatarUrl, loadAvatarPicture, peekAvatarBitmap, peekAvatarUrl, preloadAvatarAssets,
} from './compose';
export type { AvatarCacheStats, ComposeOptions } from './compose';
export { FRAME_MARGIN, ICON_MIN_HEAD, frameLook, layoutLook, placeBox } from './layout';
export type { AvatarCrop, AvatarLayer, Box, PlacedItem } from './layout';
export type { DressingRoomProps } from './room-contract';
