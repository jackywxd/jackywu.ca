/** satori 不吃 CSS 變數，色票要寫成字面值。與 theme.css 保持一致。 */
export const C = {
  paper: '#f2efe6',
  panel: '#e8e3d6',
  edge:  '#dcd5c4',
  ink:   '#2b2724',
  soft:  '#4a443f',
  stone: '#8c8781',
  seal:  '#b93a32',
} as const;

export const REALM_ACCENT: Record<string, string> = {
  run: '#b93a32', snow: '#6e7a85', road: '#8a5a2b', wild: '#4e6152', forge: '#6b6560',
};
