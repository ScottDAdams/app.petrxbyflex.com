import { Routes, Route, Navigate } from "react-router-dom"
import { AppLayout } from "./AppLayout"
import { PublicLayout } from "../layouts/PublicLayout"
import { Start } from "../routes/Start"
import DrugSearchPage from "../features/prescriptions/pages/DrugSearchPage"
import DrugPricePage from "../features/prescriptions/pages/DrugPricePage"

export function App() {
  return (
    <Routes>
      <Route path="/" element={<AppLayout />}>
        <Route index element={null} />
        <Route path="start" element={<Start />} />
      </Route>
      <Route path="/prescriptions" element={<PublicLayout />}>
        <Route index element={<Navigate to="drug-search" replace />} />
        <Route path="drug-search" element={<DrugSearchPage />} />
        <Route path="drug-price" element={<DrugPricePage />} />
      </Route>
      <Route path="/drug-search" element={<Navigate to="/prescriptions/drug-search" replace />} />
    </Routes>
  )
}
