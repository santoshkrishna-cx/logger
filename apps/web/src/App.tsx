import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { useMe } from "./hooks";
import { AnalyticsPage } from "./pages/Analytics";
import { CalendarPage } from "./pages/Calendar";
import { DashboardPage } from "./pages/Dashboard";
import { ImportPage } from "./pages/Import";
import { LessonsPage } from "./pages/Lessons";
import { LogPage } from "./pages/Log";
import { LoginPage } from "./pages/Login";
import { RulesPage } from "./pages/Rules";
import { SettingsPage } from "./pages/Settings";

export function App() {
  const me = useMe();
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={me.isLoading ? <div className="page muted">Opening Logger…</div> : me.data ? <Layout me={me.data} /> : <Navigate to="/login" replace />}>
        <Route index element={<DashboardPage />} />
        <Route path="log" element={<LogPage />} />
        <Route path="log/:date" element={<LogPage />} />
        <Route path="lessons" element={<LessonsPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="rules" element={<RulesPage />} />
        <Route path="import" element={<ImportPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<div className="page"><h1>That page doesn’t exist</h1><p className="lede">Use the menu above to get back to the dashboard or the log.</p></div>} />
      </Route>
    </Routes>
  );
}
