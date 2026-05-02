import { Activity, BarChart3, Bot, Globe, Radio } from "lucide-react";
import { Link, useLocation } from "wouter";

export function Shell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const links = [
    { href: "/", label: "Dashboard", icon: BarChart3 },
    { href: "/markets", label: "Markets", icon: Globe },
    { href: "/signals", label: "Signals", icon: Radio },
    { href: "/trades", label: "Trades", icon: Activity },
    { href: "/bot", label: "Bot Control", icon: Bot },
  ];

  return (
    <div className="flex min-h-screen bg-background text-foreground selection:bg-primary/20">
      {/* Sidebar */}
      <div className="w-64 border-r border-border bg-card flex flex-col hidden md:flex shrink-0">
        <div className="p-6 border-b border-border flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-primary/20 flex items-center justify-center border border-primary/50 shadow-[0_0_15px_rgba(0,255,180,0.2)]">
            <Bot className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="font-bold text-base tracking-tight text-white uppercase flex items-center gap-2">
              DEGA <span className="text-primary font-mono text-xs">bot_v1</span>
            </h1>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-2 px-3">Terminal</div>
          {links.map((link) => {
            const isActive = location === link.href;
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? "bg-primary/10 text-primary border border-primary/20 shadow-[inset_2px_0_0_var(--color-primary)]"
                    : "text-muted-foreground hover:text-white hover:bg-white/5 border border-transparent"
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border">
          <div className="text-xs text-muted-foreground flex items-center justify-between font-mono">
            <span>SYS_STATUS</span>
            <span className="text-primary flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse shadow-[0_0_5px_var(--color-primary)]" />
              ONLINE
            </span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile Header */}
        <header className="md:hidden border-b border-border bg-card p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-primary" />
            <h1 className="font-bold text-sm text-white">DEGA BOT</h1>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-4 md:p-8">
          <div className="max-w-7xl mx-auto space-y-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
