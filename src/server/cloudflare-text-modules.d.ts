/** Wrangler imports catalog text as a static module, without an asset fetch during requests. */
declare module "*catalog-summary.txt" {
  const text: string;
  export default text;
}
