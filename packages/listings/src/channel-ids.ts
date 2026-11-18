export const CHANNELS = [
  { id: "ebay", label: "eBay" },
  { id: "cardtrader", label: "CardTrader" },
] as const;
export type ChannelId = (typeof CHANNELS)[number]["id"];
export const isChannel = (value: string): value is ChannelId => CHANNELS.some((c) => c.id === value);
