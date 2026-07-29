"use client";
import { FormEvent, useState } from "react";
export default function Login() {
  const [password,setPassword]=useState(""); const [error,setError]=useState(""); const [loading,setLoading]=useState(false);
  async function submit(e:FormEvent){e.preventDefault();setLoading(true);setError("");const r=await fetch("/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({password})});if(r.ok)location.href="/";else setError("Senha incorreta.");setLoading(false)}
  return <main className="login"><form onSubmit={submit}><div className="login-mark">L</div><p>ACESSO PRIVADO</p><h1>Bem-vindo ao LionBan</h1><span>Entre para gerenciar suas correções autônomas.</span><label>Senha<input autoFocus type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Sua senha de administrador" /></label>{error&&<b>{error}</b>}<button className="primary" disabled={loading||!password}>{loading?"Entrando...":"Entrar →"}</button></form></main>
}
