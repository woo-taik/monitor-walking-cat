export const COATS = {
  cheese: { name: '치즈', fur: '#FFD99B', cream: '#FFF0D0', stripe: '#DE9959', pink: '#F3A2A3', ink: '#594136', farFur: '#E8BD80', farInk: '#88634B', blush: '#EFB3A0', eyes: '#594136' },
  gray: { name: '회색', fur: '#AEB8C4', cream: '#E6EAF0', stripe: '#798695', pink: '#E5A0AC', ink: '#36404C', farFur: '#8D99A8', farInk: '#536171', blush: '#D9ACB5', eyes: '#36404C' },
  black: { name: '검정', fur: '#454651', cream: '#B7B2B7', stripe: '#292A34', pink: '#E5A0AC', ink: '#1E202B', farFur: '#34353F', farInk: '#22232D', blush: '#BC8E9D', eyes: '#F2D17E' }
} as const;
export type CatCoat = keyof typeof COATS;
export function isCatCoat(value: unknown): value is CatCoat {
  return typeof value === 'string' && Object.hasOwn(COATS, value);
}
