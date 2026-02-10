import type { SessionData } from "../api/session"

export type MockStep = "quote" | "details" | "payment" | "confirm"

const MOCK_MEMBER = "FRX_MOCK_0001"
const CARD_IMAGE = "https://api.petrxbyflex.com/api/card-image/FRX001000261"
const WALLET_PASS = "https://api.petrxbyflex.com/api/generate/apple-pass/FRX001000261.pkpass"
const QR_APPLE = "https://api.petrxbyflex.com/api/qr-code/apple/FRX001000261"
const QR_ANDROID = "https://api.petrxbyflex.com/api/qr-code/android/FRX001000261"

const baseSession = {
  member_id: MOCK_MEMBER,
  funnel_type: "card_plus_quote",
  pet_name: "Fluffy",
  pet: {
    type: "Dog",
    breed: "Mixed",
    age: "3 years",
  },
  card_image_url: CARD_IMAGE,
  wallet_url: WALLET_PASS,
  wallet_pass_url: WALLET_PASS,
  qr_code_url: QR_APPLE,
  qr_code_url_android: QR_ANDROID,
}

/* Reimbursement stored as decimal (0.8 = 80%); UI multiplies by 100 for display */
const insurancePlans = [
  {
    plan_id: "hp_basic",
    plan_name: "Basic",
    deductible: 500,
    reimbursement: 0.8,
    monthly_price: 34.99,
    monthly_premium: "34.99",
    coverage_summary: "Accidents & illnesses",
  },
  {
    plan_id: "hp_plus",
    plan_name: "Plus",
    deductible: 250,
    reimbursement: 0.9,
    monthly_price: 52.99,
    monthly_premium: "52.99",
    coverage_summary: "Accidents & illnesses + extras",
  },
]

const singlePlan = [insurancePlans[0]]

export const mockSessions: Record<MockStep, SessionData> = {
  quote: {
    ...baseSession,
    session_id: "mock-quote",
    current_step: "quote",
    insurance_products: insurancePlans,
  } as SessionData,
  details: {
    ...baseSession,
    session_id: "mock-details",
    current_step: "details",
    insurance_products: singlePlan,
    selected_plan_id: "hp_basic",
  } as SessionData,
  payment: {
    ...baseSession,
    session_id: "mock-payment",
    current_step: "payment",
    insurance_products: singlePlan,
    selected_plan_id: "hp_basic",
  } as SessionData,
  confirm: {
    ...baseSession,
    session_id: "mock-confirm",
    current_step: "confirm",
    insurance_products: singlePlan,
    selected_plan_id: "hp_basic",
  } as SessionData,
}
