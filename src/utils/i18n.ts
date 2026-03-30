export const isEnglish = navigator.language.toLowerCase().startsWith('en');

export function t(en: string, pt: string): string {
  return isEnglish ? en : pt;
}
