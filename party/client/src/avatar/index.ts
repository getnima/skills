/** Avatar system: one import for the rest of the client. See ./README.md. */
export * from '../../../shared/avatar';
export { Avatar, useAvatarUrl } from './Avatar';
export type { AvatarProps } from './Avatar';
export {
  AVATAR_BGS, BASE_ITEMS, CATALOG_PROBLEMS, DEFAULT_TOWER, DOLL, ITEMS, ITEM_IDS, LAYER_ORDER,
  canCarry, canStack, getBg, getItem, itemAr, itemsOfSlot, normalizeLook, plateColor, tapItem,
} from './catalog';
export type { AvatarBg, AvatarBgKind, AvatarFly, AvatarItem, AvatarSnd, AvatarTower } from './catalog';
export {
  AVATAR_BUCKETS, AVATAR_CACHE_MAX, avatarBucket, avatarCacheStats, avatarCanvas, avatarUrl, clearAvatarCache,
  composeAvatar, drawPlate, holdAvatarUrl, peekAvatarUrl, preloadAvatarAssets,
} from './compose';
export type { ComposeOptions } from './compose';
export { FRAME_MARGIN, frameLook, layoutLook, placeBox } from './layout';
export type { AvatarCrop, AvatarLayer, Box, PlacedItem } from './layout';
export type { DressingRoomProps } from './room-contract';
