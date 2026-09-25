import { colors } from './colors.js';
import { typography } from './typography.js';
import { spacing } from './spacing.js';
import { radii } from './radii.js';
import { shadows } from './shadows.js';
import { motion } from './motion.js';
import { zIndex } from './z-index.js';

export const tokens = {
  colors,
  typography,
  spacing,
  radii,
  shadows,
  motion,
  zIndex,
};

export const tailwindPreset = {
  theme: {
    extend: {
      colors,
      fontFamily: typography.fontFamily,
      fontSize: typography.fontSize,
      fontWeight: typography.fontWeight,
      spacing,
      borderRadius: radii,
      boxShadow: shadows,
      transitionDuration: motion.duration,
      transitionTimingFunction: motion.easing,
      zIndex,
    },
  },
};
