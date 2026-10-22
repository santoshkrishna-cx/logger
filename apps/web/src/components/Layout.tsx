import { useQuery } from "@tanstack/react-query";
import { NavLink, Outlet, useOutletContext } from "react-router-dom";
import { api, type Me } from "../api";

export const useLayout = () => useOutletContext<{ me: Me }>();

export function Layout({ me }: { me: Me }) {
  const lessons = useQuery({ queryKey: ["lessons", "count"], queryFn: () => api.get<{ waitingOnMe: number }>("/api/lessons") });
  const name = me.accounts.find(a => a.code === me.user.account)?.ownerName ?? me.user.name ?? me.user.email;
  const link = (to: string, label: string, extra?: number) => (
    <NavLink to={to} end={to === "/"} className={({ isActive }) => (isActive ? "active" : "")}>
      {label}{extra ? <span className="count" aria-label={`${extra} waiting on you`}>{extra}</span> : null}
    </NavLink>
  );
  return (
    <>
      <header className="top">
        <div className="top-in">
          <NavLink to="/" className="brand">Logger</NavLink>
          <nav className="nav" aria-label="Main">
            {link("/", "Dashboard")}
            {link("/log", "Log")}
            {link("/lessons", "Lessons", lessons.data?.waitingOnMe)}
            {link("/analytics", "Analytics")}
            {link("/calendar", "Calendar")}
            {link("/rules", "Rules")}
            {link("/import", "Import")}
            {link("/settings", "Settings")}
          </nav>
          <div className="who">
            {me.user.avatarUrl && <img src={me.user.avatarUrl} alt="" referrerPolicy="no-referrer" />}
            <span>{name}</span>
            <button className="btn small ghost" onClick={() => api.logout()}>Sign out</button>
          </div>
        </div>
      </header>
      <Outlet context={{ me }} />
    </>
  );
}
