"use client";
import { FormEvent, useState } from "react";
export default function Login() {
  const [username,setUsername]=useState(""); const [password,setPassword]=useState(""); const [error,setError]=useState(""); const [loading,setLoading]=useState(false);
  async function submit(e:FormEvent){e.preventDefault();setLoading(true);setError("");const r=await fetch("/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username,password})});if(r.ok)location.href="/";else setError("Usuário ou senha incorretos.");setLoading(false)}
  return <main className="login"><form onSubmit={submit}><div className="login-mark">L</div><p>ACESSO PRIVADO</p><h1>Bem-vindo ao LionWorkForce</h1><span>Entre para gerenciar suas correções autônomas.</span><label>Usuário<input autoFocus autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)} placeholder="Seu usuário" /></label><label>Senha<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Sua senha de administrador" /></label>{error&&<b>{error}</b>}<button className="primary" disabled={loading||!username||!password}>{loading?"Entrando...":"Entrar →"}</button></form></main>
}
