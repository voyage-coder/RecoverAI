import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import RecoveryCases from "./pages/RecoveryCases";
import CaseDetails from "./pages/CaseDetails";
import Analytics from "./pages/Analytics";
import Activity from "./pages/Activity";
import Settings from "./pages/Settings";
import PaymentEventSimulator from "./pages/PaymentEventSimulator";
import EventConsole from "./pages/EventConsole";
import DemoHealth from "./pages/DemoHealth";
import BatchRecoveryDemo from "./pages/BatchRecoveryDemo";
import Operations from "./pages/Operations";
import LiveActivity from "./pages/LiveActivity";
import Integrations from "./pages/Integrations";
import CustomerRecover from "./pages/CustomerRecover";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="recover/:token" element={<CustomerRecover />} />
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="operations" element={<Operations />} />
          <Route path="live-activity" element={<LiveActivity />} />
          <Route path="integrations" element={<Integrations />} />
          <Route path="event-console" element={<EventConsole />} />
          <Route path="demo-health" element={<DemoHealth />} />
          <Route path="cases" element={<RecoveryCases />} />
          <Route path="cases/:caseId" element={<CaseDetails />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="activity" element={<Activity />} />
          <Route path="settings" element={<Settings />} />
          <Route path="simulate" element={<PaymentEventSimulator />} />
          <Route path="batch-demo" element={<BatchRecoveryDemo />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
