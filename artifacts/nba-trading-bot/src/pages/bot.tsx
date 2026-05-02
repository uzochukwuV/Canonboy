import { Shell } from "@/components/layout/Shell";
import { formatMoney, formatDate } from "@/lib/format";
import { useGetBotStatus, useGetBotLogs, useStartBot, useStopBot, getGetBotStatusQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Terminal, Play, Square, Settings2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";

export default function BotControl() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const { data: botStatus } = useGetBotStatus({ query: { refetchInterval: 2000 } });
  const { data: logs } = useGetBotLogs({ limit: 100 }, { query: { refetchInterval: 3000 } });
  
  const startBot = useStartBot();
  const stopBot = useStopBot();

  const logsEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const handleToggleState = async () => {
    if (!botStatus) return;
    
    try {
      if (botStatus.isRunning) {
        await stopBot.mutateAsync();
        toast({ title: "Bot Stopped", description: "Trading engine halted.", variant: "default" });
      } else {
        await startBot.mutateAsync();
        toast({ title: "Bot Started", description: "Trading engine online.", variant: "default" });
      }
      queryClient.invalidateQueries({ queryKey: getGetBotStatusQueryKey() });
    } catch (err) {
      toast({ title: "Error", description: "Failed to toggle bot state", variant: "destructive" });
    }
  };

  const getLogLevelStyle = (level: string) => {
    switch (level) {
      case 'info': return 'text-muted-foreground';
      case 'signal': return 'text-primary font-bold';
      case 'trade': return 'text-green-400 font-bold';
      case 'warn': return 'text-yellow-400';
      case 'error': return 'text-destructive';
      default: return 'text-muted-foreground';
    }
  };

  const formatUptime = (seconds: number | null | undefined) => {
    if (seconds == null) return "00:00:00";
    const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  return (
    <Shell>
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-white">Bot Control</h2>
        <p className="text-muted-foreground font-mono text-sm mt-1">Configure and monitor the automated execution engine</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-6">
          <Card className="bg-card border-border shadow-md">
            <CardContent className="pt-6">
              <div className="flex flex-col items-center justify-center text-center space-y-4">
                <div className={`w-24 h-24 rounded-full flex items-center justify-center border-4 ${botStatus?.isRunning ? 'border-primary/50 bg-primary/10 shadow-[0_0_30px_rgba(0,255,180,0.3)]' : 'border-muted bg-secondary shadow-none'} transition-all duration-500`}>
                  <Terminal className={`w-10 h-10 ${botStatus?.isRunning ? 'text-primary' : 'text-muted-foreground'}`} />
                </div>
                
                <div>
                  <h3 className="font-bold text-xl text-white tracking-tight">ENGINE STATE</h3>
                  <Badge variant="outline" className={`mt-2 font-mono text-xs ${botStatus?.isRunning ? 'text-primary border-primary bg-primary/10' : 'text-destructive border-destructive bg-destructive/10'}`}>
                    {botStatus?.isRunning ? 'ONLINE & SCANNING' : 'OFFLINE'}
                  </Badge>
                </div>

                <Button 
                  size="lg" 
                  className={`w-full mt-4 font-mono font-bold tracking-widest ${botStatus?.isRunning ? 'bg-destructive hover:bg-destructive/90 text-white' : 'bg-primary hover:bg-primary/90 text-primary-foreground shadow-[0_0_15px_var(--color-primary)]'}`}
                  onClick={handleToggleState}
                  disabled={startBot.isPending || stopBot.isPending}
                >
                  {botStatus?.isRunning ? (
                    <><Square className="w-4 h-4 mr-2" /> HALT ENGINE</>
                  ) : (
                    <><Play className="w-4 h-4 mr-2" /> START ENGINE</>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border shadow-md">
            <CardHeader className="pb-2 border-b border-border/50">
              <CardTitle className="text-sm font-mono text-white flex items-center gap-2">
                <Settings2 className="w-4 h-4 text-primary" />
                Configuration & Stats
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-3 font-mono text-sm">
              <div className="flex justify-between items-center pb-2 border-b border-border/30">
                <span className="text-muted-foreground">Uptime</span>
                <span className="text-white">{formatUptime(botStatus?.uptime)}</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-border/30">
                <span className="text-muted-foreground">Strategy</span>
                <span className="text-primary">{botStatus?.strategy || '—'}</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-border/30">
                <span className="text-muted-foreground">Scan Interval</span>
                <span className="text-white">{botStatus?.scanIntervalSeconds}s</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-border/30">
                <span className="text-muted-foreground">Signals Gen.</span>
                <span className="text-white">{botStatus?.totalSignalsGenerated || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Trades Exec.</span>
                <span className="text-white">{botStatus?.totalTradesExecuted || 0}</span>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card className="bg-black border-border shadow-md h-full flex flex-col min-h-[500px]">
            <CardHeader className="py-3 px-4 border-b border-border bg-secondary/30 flex flex-row items-center justify-between shrink-0">
              <CardTitle className="text-xs font-mono text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                <Terminal className="w-3 h-3" /> System Terminal
              </CardTitle>
              {botStatus?.isRunning && (
                <span className="flex items-center gap-1.5 text-[10px] font-mono text-primary">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                  LIVE STREAM
                </span>
              )}
            </CardHeader>
            <CardContent className="p-0 flex-1 overflow-hidden relative">
              <div className="absolute inset-0 overflow-y-auto p-4 font-mono text-xs leading-relaxed space-y-1.5">
                {!logs?.length && (
                  <div className="text-muted-foreground opacity-50">Initializing terminal...</div>
                )}
                {logs?.map((log) => (
                  <div key={log.id} className="flex flex-col sm:flex-row gap-2 sm:gap-4 border-b border-white/5 pb-1 last:border-0 hover:bg-white/5 transition-colors group">
                    <div className="shrink-0 text-muted-foreground opacity-60 w-[140px]">
                      [{formatDate(log.createdAt)}]
                    </div>
                    <div className="flex-1 break-words">
                      <span className={`${getLogLevelStyle(log.level)} mr-2 uppercase text-[10px] tracking-widest`}>
                        [{log.level}]
                      </span>
                      <span className="text-gray-300">{log.message}</span>
                      {log.details && (
                        <div className="mt-1 pl-4 text-muted-foreground/70 text-[10px] whitespace-pre-wrap font-sans opacity-0 group-hover:opacity-100 transition-opacity">
                          {log.details}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </Shell>
  );
}
