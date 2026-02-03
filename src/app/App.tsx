import { Routes, Route } from "react-router-dom"
import { AppLayout } from "./AppLayout"
import { Start } from "../routes/Start"

export function App() {
  return (
    <Routes>
      <Route path="/" element={<AppLayout />}>
        <Route index element={null} />
        <Route path="start" element={<Start />} />
      </Route>
    </Routes>
  )
}
