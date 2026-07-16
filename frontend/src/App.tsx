import { Navigate, Routes, Route } from "react-router-dom";
import LoginPage from "./pages/LoginPage.tsx";
import AdminLoginPage from "./pages/AdminLoginPage.tsx";
import InstructionsPage from "./pages/InstructionsPage.tsx";
import OnboardingPage from "./pages/OnboardingPage.tsx";
import QuizPage from "./pages/QuizPage.tsx";
import ThanksPage from "./pages/ThanksPage.tsx";
import ResultPage from "./pages/ResultPage.tsx";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LoginPage />} />
      <Route path="/admin/login" element={<AdminLoginPage />} />
      <Route path="/admin/reset-password" element={<AdminLoginPage />} />
      <Route path="/admin" element={<Navigate to="/onboarding" replace />} />
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route path="/instructions" element={<InstructionsPage />} />
      <Route path="/quiz/:attemptId" element={<QuizPage />} />
      <Route path="/thanks/:attemptId" element={<ThanksPage />} />
      <Route path="/results/:attemptId" element={<ResultPage />} />
    </Routes>
  );
}
