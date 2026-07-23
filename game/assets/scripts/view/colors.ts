import { Color } from 'cc';

/** Placeholder color palette shared by cars and passengers (keys match core color strings). */
export const COLORS: Record<string, Color> = {
    red: new Color(230, 70, 70),
    blue: new Color(70, 120, 230),
    green: new Color(90, 200, 90),
    yellow: new Color(240, 210, 70),
    purple: new Color(170, 90, 210),
    cyan: new Color(80, 200, 210),
};

export function colorOf(name: string): Color {
    return COLORS[name] ?? Color.GRAY.clone();
}
