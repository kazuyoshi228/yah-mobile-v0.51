/**
 * FsUser — Firestore users コレクションのドキュメント型（サーバー/クライアント共通の唯一の定義）。
 * クライアント側は shared/userTypes.ts から再エクスポートを参照する。
 */
export interface FsUser {
  id: string; // Firestore doc ID = Firebase UID
  uid: string; // Firebase UID (same as id)
  email?: string | null;
  name?: string | null;
  role: "user" | "admin";
  status?: "active" | "suspended" | null;
  loginMethod?: string | null;
  // プロフィール
  fullName?: string | null;
  nationality?: string | null;
  age?: number | null;
  phoneNumber?: string | null;
  preferredLanguage?: string | null;
  marketing?: {
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    referralCode?: string;
  } | null;
  demographics?: {
    locale?: string;
    timezone?: string;
    country?: string;
  } | null;
  device?: {
    deviceModel?: string;
    osVersion?: string;
    appVersion?: string;
  } | null;
  preferences?: {
    emailMarketing?: boolean;
    pushNotifications?: boolean;
  } | null;
  metrics?: {
    ltvJpy?: number;
    orderCount?: number;
    lastPurchaseDate?: number;
  } | null;
  stripeCustomerId?: string | null;
  sessionRevokedAt?: unknown | null;
  lastSignedIn?: number;
  lastLoginAt?: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface FsPlan {
  id: string;
  bappyPlanId: string;
  planType?: string | null;
  name: string;
  dataGb: number;
  validityDays: number;
  priceJpy: number;
  coverageCountries?: string[] | null;
  sponsorProfile?: string | null;
  isActive: boolean;
  recommendedFor?: string | null;
  isPopular: boolean;
  sortOrder: number;
  description?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface FsOrder {
  id: string;
  userId: string;
  planId: string;
  bappyPlanId: string;
  status: "pending" | "paid" | "provisioning" | "pending_retry" | "fulfilled" | "failed" | "refunded" | "cancelled";
  amountJpy: number;
  discountAmount?: number | null;
  promoCode?: string | null;
  stripePaymentIntentId?: string | null;
  stripeSessionId?: string | null;
  checkoutUrl?: string | null;
  guestEmail?: string | null;
  guestToken?: string | null;
  hiddenByUser: boolean;
  purchaseCountry?: string | null;
  purchaseCity?: string | null;
  purchaseTimezone?: string | null;
  planName?: string | null;
  esimLinkUuid?: string | null;
  orderType?: string | null;
  userEmail?: string | null;
  userName?: string | null;
  discountPercentage?: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface FsEsimLink {
  id: string;
  orderId: string;
  userId: string;
  bappyLinkUuid: string;
  iccid: string;
  lpaProfile: string;
  appleActivationUrl?: string | null;
  androidActivationUrl?: string | null;
  dataRemainingMb?: number | null;
  dataTotalMb?: number | null;
  expiryDate?: string | null;
  status: "active" | "inactive" | "expired" | "provisioning" | "failed";
  qrCodeUrl?: string | null;
  lastActiveAt?: number | null;
  installedDeviceModel?: string | null;
  planId?: string | null;
  planName?: string | null;
  totalDataGb?: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface FsEsimActivation {
  id: string;
  esimLinkId: string;
  bappyActivationUuid: string;
  bappyPlanId: string;
  status: "active" | "expired" | "cancelled";
  expiryDate?: number | null;
  dataRemainingMb?: number | null;
  activationType: "initial" | "topup";
  planName?: string | null;
  totalDataGb?: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface FsStripeEvent {
  id: string;
  stripeEventId: string;
  eventType: string;
  processed: boolean;
  note?: string | null;
  createdAt: number;
  expiresAt?: number | null;
}

export interface FsNotification {
  id: string;
  userId: string;
  title: string;
  body: string;
  type: "order_delayed" | "order_fulfilled" | "order_failed" | "topup_success" | "data_threshold_80" | "data_threshold_100" | "refund_completed" | "system";
  isRead: "true" | "false";
  orderId?: string | null;
  createdAt: number;
}

export interface FsContactInquiry {
  id: string;
  name: string;
  email: string;
  location?: string | null;
  category?: string | null;
  detail?: string | null;
  message: string;
  status: "pending" | "in_progress" | "resolved" | "closed";
  note?: string | null;
  userId?: string | null;
  orderId?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface FsAllowedEmail {
  id: string;
  email: string;
  note?: string | null;
  createdAt: number;
}

export interface FsEsimRetryJob {
  id: string;
  orderId: string;
  userId: string;
  bappyPlanId: string;
  stripeSessionId: string;
  isTopup: boolean;
  parentOrderId?: string | null;
  esimLinkUuid?: string | null;
  retryCount: number;
  maxRetries: number;
  status: string;
  lastError?: string | null;
  nextRetryAt?: number | null;
  expiresAt?: number | null;
  resolvedAt?: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface FsIncidentLog {
  id: string;
  type?: string;
  incidentType?: string;
  severity: string;
  title?: string;
  detail?: string | null;
  status: string;
  orderId?: string | null;
  userId?: string | null;
  errorMessage?: string;
  errorStack?: string | null;
  context?: Record<string, unknown> | null;
  resolvedAt?: number | null;
  resolutionNote?: string | null;
  resolvedBy?: string | null;
  notifiedOwner?: boolean | null;
  notifiedOmax?: boolean | null;
  createdAt: number;
  updatedAt: number;
}

export interface FsUserConsent {
  id: string;
  userId: string;
  consentType?: string | null;
  version?: string | null;
  granted?: boolean;
  termsVersion?: string;
  privacyVersion?: string;
  marketingOptIn?: boolean;
  ipAddress?: string | null;
  userAgent?: string | null;
  consentedAt?: number;
  createdAt?: number;
}

export interface FsExchangeRate {
  id: string;
  currency: string;
  rateToJpy: number;
  source: string;
  createdAt: number;
}

export interface FsPromotion {
  id: string;
  code: string;
  discountType: "percentage" | "fixed";
  discountValue: number;
  isActive: boolean;
  maxUses?: number | null;
  currentUses: number;
  expiresAt?: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface FsSystemStats {
  id: string;
  totalUsers: number;
  totalOrders: number;
  totalRevenueJpy: number;
  activeEsims: number;
  lastUpdated: number;
}

export interface FsEsimUsageLog {
  id: string;
  timestamp: number;
  eventType: "data_threshold_80" | "data_depleted" | "esim_installed" | "activation_started" | "status_changed" | "other";
  dataRemainingMb?: number | null;
  detail?: string | null;
}

export interface FsSystemStat {
  id: string;
  totalRevenueJpy: number;
  totalOrders: number;
  updatedAt: number;
}
