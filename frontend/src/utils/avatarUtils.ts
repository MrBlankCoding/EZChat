/**
 * Utility functions for avatar generation
 */

/**
 * Generates a background color based on a string
 * @param name The string to generate a color from
 * @returns A HEX color code
 */
export const getColorFromName = (name: string): string => {
  // Use the first character to generate a consistent color
  const firstChar = name.charAt(0).toLowerCase();
  const charCode = firstChar.charCodeAt(0);
  
  // Create a set of vibrant colors
  const colors = [
    '#FF5733', // Coral
    '#33A8FF', // Azure
    '#33FF57', // Mint
    '#FF33A8', // Pink
    '#A833FF', // Purple
    '#FFD133', // Gold
    '#3390FF', // Royal Blue
    '#FF8C33', // Orange
    '#33FFD1', // Turquoise
    '#8CFF33', // Lime
    '#FF33D1', // Magenta
    '#33FFA8', // Spring Green
    '#D133FF', // Violet
    '#4633FF', // Indigo
    '#FF333C', // Red
  ];
  
  // Get a deterministic index based on the character code
  const colorIndex = charCode % colors.length;
  return colors[colorIndex];
};

/**
 * Generates an avatar SVG with the first letter of the name
 * @param name The name to use for the avatar
 * @param size The size of the avatar in pixels
 * @returns A data URL containing the SVG avatar
 */
export const generateAvatarUrl = (name: string, size: number = 150): string => {
  if (!name) {
    // Return a default avatar for empty names
    return `data:image/svg+xml,${encodeURIComponent(
      `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${size}" height="${size}" fill="#CCCCCC"/>
        <text x="50%" y="50%" dy=".1em" font-family="Arial, sans-serif" font-size="${size/2}px" fill="white" text-anchor="middle" dominant-baseline="middle">?</text>
      </svg>`
    )}`;
  }
  
  const initial = name.charAt(0).toUpperCase();
  const backgroundColor = getColorFromName(name);
  
  // Create an SVG with the initial and background color
  const svg = `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${size}" height="${size}" fill="${backgroundColor}"/>
      <text x="50%" y="50%" dy=".1em" font-family="Arial, sans-serif" font-size="${size/2}px" fill="white" text-anchor="middle" dominant-baseline="middle">${initial}</text>
    </svg>
  `;
  
  // Convert SVG to a data URL
  return `data:image/svg+xml,${encodeURIComponent(svg.trim())}`;
}; 