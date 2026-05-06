import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "sonner";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Display from "./pages/Display";
import Upload from "./pages/Upload";
import Control from "./pages/Control";
import Playout from "./pages/Playout";
import ProtectedRoute from "./components/ProtectedRoute";

function App() {
  return (
    <div className="App min-h-screen bg-[#050505] text-zinc-100">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/display" element={<Display />} />
          <Route path="/display/:room" element={<Display />} />
          <Route
            path="/upload"
            element={
              <ProtectedRoute>
                <Upload />
              </ProtectedRoute>
            }
          />
          <Route
            path="/control"
            element={
              <ProtectedRoute>
                <Control />
              </ProtectedRoute>
            }
          />
          <Route
            path="/control/:room"
            element={
              <ProtectedRoute>
                <Control />
              </ProtectedRoute>
            }
          />
          <Route
            path="/playout"
            element={
              <ProtectedRoute>
                <Playout />
              </ProtectedRoute>
            }
          />
          <Route
            path="/playout/:room"
            element={
              <ProtectedRoute>
                <Playout />
              </ProtectedRoute>
            }
          />
        </Routes>
      </BrowserRouter>
      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{
          style: {
            background: "#0A0A0A",
            color: "#F4F4F5",
            border: "1px solid rgba(255,255,255,0.08)",
          },
        }}
      />
    </div>
  );
}

export default App;
