import { colors } from './colors';
import { radius } from './radius';
import { spacing } from './spacing';
import { fontFamily, fontSize, fontWeight, lineHeight } from './typography';

export { colors, fontFamily, fontSize, fontWeight, lineHeight, radius, spacing };

export const theme = {
  colors,
  fontFamily,
  fontSize,
  fontWeight,
  lineHeight,
  radius,
  spacing,
} as const;

export type Theme = typeof theme;
