export type FlowStep = {
  id: string
  label: string
  route: string
}

export const FLOW_STEPS: FlowStep[] = [
  { id: "quote", label: "Quote", route: "#quote" },
  { id: "details", label: "Details", route: "#details" },
  { id: "payment", label: "Payment", route: "#payment" },
  { id: "confirm", label: "Confirm", route: "#confirm" },
]
