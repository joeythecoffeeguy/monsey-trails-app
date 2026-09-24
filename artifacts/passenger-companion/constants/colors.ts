/**
 * Semantic design tokens for the mobile app.
 *
 * This palette provides a modern, vibrant transit application feel,
 * tailored to Monsey Trails (Deep Navy and Monsey Lime).
 */

const colors = {
  light: {
    // Core surfaces
    background: '#F5F7F9',
    foreground: '#062341', // Monsey Dark Navy

    // Cards / elevated surfaces
    card: '#FFFFFF',
    cardForeground: '#062341',

    // Primary action color
    primary: '#CAF020', // Monsey Lime / Vivid Yellow-Green
    primaryForeground: '#062341', // Monsey Navy text on Lime

    // Secondary / less-emphasis interactive surfaces
    secondary: '#062341', // Monsey Dark Navy
    secondaryForeground: '#FFFFFF',

    // Muted / subdued elements
    muted: '#E2E8F0', // slate-200
    mutedForeground: '#64748B', // slate-500

    // Accent highlights
    accent: '#E2E8F0',
    accentForeground: '#062341',

    // Destructive actions
    destructive: '#EF4444',
    destructiveForeground: '#FFFFFF',

    // Success states
    success: '#10B981',
    arrival: '#F97316',

    // Borders and input outlines
    border: '#CBD5E1', // slate-300
    input: '#FFFFFF',
  },

  dark: {
    // Core surfaces
    background: '#041B33', // Deep Navy background
    foreground: '#F5F7F9',

    // Cards / elevated surfaces
    card: '#062341', // Monsey Dark Navy
    cardForeground: '#F5F7F9',

    // Primary action color
    primary: '#CAF020', // Monsey Lime
    primaryForeground: '#062341', // Monsey Navy text on Lime

    // Secondary / less-emphasis interactive surfaces
    secondary: '#09315A', // Lighter Navy
    secondaryForeground: '#F5F7F9',

    // Muted / subdued elements
    muted: '#0F467E',
    mutedForeground: '#94A3B8',

    // Accent highlights
    accent: '#0F467E',
    accentForeground: '#F5F7F9',

    // Destructive actions
    destructive: '#EF4444',
    destructiveForeground: '#FFFFFF',

    // Success states
    success: '#4CAF50',
    arrival: '#FB923C',

    // Borders and input outlines
    border: '#0F467E',
    input: '#062341',
  },

  radius: 12,
};

export default colors;
