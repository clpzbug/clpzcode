// Scaffold stub for the clpzcode TUI frontend port.
//
// The real WalletManager manages an on-disk x402 keypair and queries chain
// balances. app.tsx only uses WalletManager.exists()/getWalletData()/getBalance()
// to populate the wallet picker; the port reports "no wallet".

export interface WalletData {
  address: string;
  chain: string;
  createdAt: string;
}

export interface WalletBalance {
  address: string;
  chain: string;
  nativeSymbol: string;
  nativeBalance: string;
  usdcBalance: string;
}

export class WalletManager {
  static exists(): boolean {
    return false;
  }

  getWalletData(): WalletData {
    return { address: "", chain: "", createdAt: "" };
  }

  async getBalance(): Promise<WalletBalance> {
    return { address: "", chain: "", nativeSymbol: "", nativeBalance: "0", usdcBalance: "0" };
  }
}
