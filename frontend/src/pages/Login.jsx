import React, { useState } from "react";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";
import Card from "../components/ui/Card";
import { useAuth } from "../context/AuthContext";

export default function Login({ onSuccess, onShowRegister }) {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await login(email, password);
      if (!result.success) throw new Error(result.error || "Invalid email or password");
      onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 dark:bg-[#171525]">
      <Card className="w-full max-w-md p-8">
        <div className="text-center mb-6">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-tr from-[#D946A8] to-[#7C5CFC] text-white font-extrabold text-2xl shadow-md shadow-[#D946A8]/20 mb-4">
            I
          </div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white">InventIQ</h1>
          <p className="text-xs text-slate-400 dark:text-slate-500">AI Inventory Intelligence</p>
        </div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Sign In</h2>
        {error && <p className="text-sm text-rose-600 dark:text-rose-400 mb-3">{error}</p>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
          />
          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            required
          />
          <Button variant="gradient" type="submit" className="w-full" loading={loading}>
            Sign In
          </Button>
        </form>
        <p className="mt-5 text-center text-sm text-slate-500 dark:text-slate-400">
          New to InventIQ?{" "}
          <button type="button" onClick={onShowRegister} className="font-semibold text-fuchsia-600 hover:text-fuchsia-700 dark:text-fuchsia-400">
            Create an account
          </button>
        </p>
      </Card>
    </div>
  );
}
