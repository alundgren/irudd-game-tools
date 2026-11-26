export {};

declare global {
  type HeadersInit = NonNullable<RequestInit["headers"]>;
}
