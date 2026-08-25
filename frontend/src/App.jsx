import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import RecoveryCases from "./pages/RecoveryCases";
import CaseDetails from "./pages/CaseDetails";
import Analytics from "./pages/Analytics";
import Activity from "./pages/Activity";
import Settings from "./pages/Settings";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="cases" element={<RecoveryCases />} />
          <Route path="cases/:caseId" element={<CaseDetails />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="activity" element={<Activity />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
