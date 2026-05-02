import { Shell } from "@/components/layout/Shell";
import { formatMoney, formatPercent, formatDate } from "@/lib/format";
import { useGetTrades } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { motion } from "framer-motion";

export default function Trades() {
  const { data: trades, isLoading } = useGetTrades({ limit: 100 }, { query: { refetchInterval: 5000 } });

  return (
    <Shell>
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-white">Trade History</h2>
        <p className="text-muted-foreground font-mono text-sm mt-1">Executed paper trades and portfolio impact</p>
      </div>

      <Card className="bg-card border-border overflow-hidden">
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-secondary/50">
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="font-mono text-xs text-muted-foreground">Opened</TableHead>
                <TableHead className="font-mono text-xs text-muted-foreground">Market</TableHead>
                <TableHead className="font-mono text-xs text-muted-foreground text-center">Direction</TableHead>
                <TableHead className="font-mono text-xs text-muted-foreground text-right">Entry</TableHead>
                <TableHead className="font-mono text-xs text-muted-foreground text-right">Size</TableHead>
                <TableHead className="font-mono text-xs text-muted-foreground text-right">P&L</TableHead>
                <TableHead className="font-mono text-xs text-muted-foreground text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground font-mono">Loading trades...</TableCell>
                </TableRow>
              ) : !trades?.length ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground font-mono">No trades executed yet</TableCell>
                </TableRow>
              ) : (
                trades.map((trade, i) => (
                  <motion.tr 
                    key={trade.id} 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.05, 0.5) }}
                    className="border-border hover:bg-secondary/20 transition-colors"
                  >
                    <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                      {formatDate(trade.openedAt)}
                    </TableCell>
                    <TableCell className="font-medium text-white max-w-[200px] truncate" title={trade.marketQuestion}>
                      {trade.marketQuestion}
                      <div className="text-[10px] text-muted-foreground font-mono mt-1">
                        Kelly: {formatPercent(trade.kellyFraction)}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className={`font-mono text-[10px] ${trade.direction === 'YES' ? 'text-primary border-primary/50' : 'text-orange-400 border-orange-400/50'}`}>
                        {trade.direction}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      ${trade.entryPrice.toFixed(3)}
                      {trade.exitPrice && (
                        <div className="text-[10px] mt-1">Exit: ${trade.exitPrice.toFixed(3)}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-white">
                      {formatMoney(trade.size)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {trade.pnl != null ? (
                        <span className={trade.pnl > 0 ? "text-primary" : trade.pnl < 0 ? "text-destructive" : "text-muted-foreground"}>
                          {trade.pnl > 0 ? "+" : ""}{formatMoney(trade.pnl)}
                          <div className="text-[10px] mt-1">
                            {trade.pnlPercent && trade.pnlPercent > 0 ? "+" : ""}{formatPercent(trade.pnlPercent)}
                          </div>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant="outline" className={`font-mono text-[10px] ${trade.status === 'open' ? 'bg-primary/10 text-primary border-primary/20 animate-pulse' : trade.status === 'closed' ? 'bg-muted/10 text-muted-foreground border-border' : 'bg-destructive/10 text-destructive border-destructive/20'}`}>
                        {trade.status.toUpperCase()}
                      </Badge>
                    </TableCell>
                  </motion.tr>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </Shell>
  );
}
