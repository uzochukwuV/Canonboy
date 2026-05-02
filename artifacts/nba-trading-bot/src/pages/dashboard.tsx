import { Shell } from "@/components/layout/Shell";
import { formatMoney, formatPercent, formatDate } from "@/lib/format";
import { useGetBotStatus, useGetPnlSummary, useGetLatestSignals, useGetTrades } from "@workspace/api-client-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { motion } from "framer-motion";
import { Link } from "wouter";

export default function Dashboard() {
  const { data: botStatus } = useGetBotStatus({ query: { refetchInterval: 5000 } });
  const { data: pnlSummary } = useGetPnlSummary({ query: { refetchInterval: 5000 } });
  const { data: latestSignals } = useGetLatestSignals({ query: { refetchInterval: 5000 } });
  const { data: recentTrades } = useGetTrades({ limit: 5 }, { query: { refetchInterval: 5000 } });

  const equityData = pnlSummary?.equityCurve?.map(p => ({
    ...p,
    time: new Date(p.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  })) || [];

  return (
    <Shell>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white">Command Center</h2>
          <p className="text-muted-foreground font-mono text-sm mt-1">Real-time market analysis and execution</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={botStatus?.isRunning ? "default" : "destructive"} className="font-mono bg-card border-border">
            {botStatus?.isRunning ? (
              <span className="flex items-center gap-2 text-primary">
                <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                ACTIVE
              </span>
            ) : (
              <span className="flex items-center gap-2 text-destructive">
                <span className="w-2 h-2 rounded-full bg-destructive" />
                HALTED
              </span>
            )}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card className="bg-card border-border shadow-md">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-mono text-muted-foreground font-medium uppercase tracking-wider">Total P&L</CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-3xl font-bold ${pnlSummary?.totalPnl && pnlSummary.totalPnl > 0 ? "text-primary" : pnlSummary?.totalPnl && pnlSummary.totalPnl < 0 ? "text-destructive" : "text-white"}`}>
                {pnlSummary?.totalPnl && pnlSummary.totalPnl > 0 ? "+" : ""}{formatMoney(pnlSummary?.totalPnl || 0)}
              </div>
              <div className="text-sm text-muted-foreground mt-1 font-mono">
                {formatPercent(pnlSummary?.totalPnlPercent || 0)} All Time
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card className="bg-card border-border shadow-md">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-mono text-muted-foreground font-medium uppercase tracking-wider">Current Bankroll</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-white">{formatMoney(pnlSummary?.bankroll || botStatus?.bankroll || 0)}</div>
              <div className="text-sm text-muted-foreground mt-1 font-mono">
                Starting: {formatMoney(pnlSummary?.startingBankroll || 0)}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card className="bg-card border-border shadow-md">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-mono text-muted-foreground font-medium uppercase tracking-wider">Win Rate</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-white">{formatPercent(pnlSummary?.winRate || 0)}</div>
              <div className="text-sm text-muted-foreground mt-1 font-mono">
                {pnlSummary?.closedTrades || 0} Closed Trades
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
          <Card className="bg-card border-border shadow-md">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-mono text-muted-foreground font-medium uppercase tracking-wider">Active Exposure</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-primary">{pnlSummary?.openTrades || 0} Trades</div>
              <div className="text-sm text-muted-foreground mt-1 font-mono">
                Running strategy: {botStatus?.strategy || '—'}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.5 }}>
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-sm font-mono text-white">Equity Curve</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={equityData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis 
                    stroke="hsl(var(--muted-foreground))" 
                    fontSize={12} 
                    tickLine={false} 
                    axisLine={false} 
                    tickFormatter={(value) => `$${value.toLocaleString()}`}
                    domain={['auto', 'auto']}
                  />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))' }}
                    itemStyle={{ color: 'hsl(var(--primary))' }}
                    formatter={(value: number) => [formatMoney(value), 'Bankroll']}
                  />
                  <ReferenceLine y={pnlSummary?.startingBankroll} stroke="hsl(var(--muted))" strokeDasharray="3 3" />
                  <Line 
                    type="monotone" 
                    dataKey="bankroll" 
                    stroke="hsl(var(--primary))" 
                    strokeWidth={2} 
                    dot={false}
                    activeDot={{ r: 6, fill: 'hsl(var(--primary))' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.6 }}>
          <Card className="bg-card border-border h-full">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-mono text-white">Latest Signals</CardTitle>
              <Link href="/signals" className="text-xs text-primary hover:underline font-mono">View All</Link>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {latestSignals?.slice(0, 5).map((signal) => (
                  <div key={signal.id} className="flex flex-col gap-2 p-3 rounded bg-secondary/30 border border-border">
                    <div className="flex justify-between items-start">
                      <div className="text-sm font-medium leading-none max-w-[70%] truncate text-white" title={signal.marketQuestion}>
                        {signal.marketQuestion}
                      </div>
                      <Badge variant="outline" className={`font-mono text-[10px] ${signal.direction === 'YES' ? 'text-primary border-primary/50' : 'text-orange-400 border-orange-400/50'}`}>
                        {signal.direction}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="text-muted-foreground">{signal.strategyType}</span>
                      <span className="text-primary">Edge: {formatPercent(signal.edge)}</span>
                    </div>
                  </div>
                ))}
                {!latestSignals?.length && (
                  <div className="text-center py-8 text-muted-foreground font-mono text-sm">No recent signals detected</div>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.7 }}>
          <Card className="bg-card border-border h-full">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-mono text-white">Recent Trades</CardTitle>
              <Link href="/trades" className="text-xs text-primary hover:underline font-mono">View All</Link>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {recentTrades?.map((trade) => (
                  <div key={trade.id} className="flex flex-col gap-2 p-3 rounded bg-secondary/30 border border-border">
                    <div className="flex justify-between items-start">
                      <div className="text-sm font-medium leading-none max-w-[70%] truncate text-white" title={trade.marketQuestion}>
                        {trade.marketQuestion}
                      </div>
                      <Badge variant="outline" className={`font-mono text-[10px] ${trade.status === 'open' ? 'text-primary border-primary/50 bg-primary/10' : trade.status === 'closed' ? 'text-muted-foreground' : 'text-destructive border-destructive/50'}`}>
                        {trade.status.toUpperCase()}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="text-muted-foreground">Size: {formatMoney(trade.size)}</span>
                      <span className={`${trade.pnl && trade.pnl > 0 ? "text-primary" : trade.pnl && trade.pnl < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                        {trade.pnl != null ? `${trade.pnl > 0 ? '+' : ''}${formatMoney(trade.pnl)}` : '—'}
                      </span>
                    </div>
                  </div>
                ))}
                {!recentTrades?.length && (
                  <div className="text-center py-8 text-muted-foreground font-mono text-sm">No recent trades</div>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </Shell>
  );
}
