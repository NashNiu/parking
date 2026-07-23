import { Color } from 'cc';

/** Placeholder color palette shared by cars and passengers (keys match core color strings). */
export const COLORS: Record<string, Color> = {
    red: new Color(244, 67, 72),
    blue: new Color(58, 134, 255),
    green: new Color(76, 205, 106),
    yellow: new Color(255, 205, 60),
    purple: new Color(178, 102, 232),
    cyan: new Color(64, 208, 216),
};

export function colorOf(name: string): Color {
    return COLORS[name] ?? Color.GRAY.clone();
}
