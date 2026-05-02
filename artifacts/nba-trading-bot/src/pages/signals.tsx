import { Shell } from "@/components/layout/Shell";
import { formatPercent, formatDate, formatMoney } from "@/lib/format";
import { useGetSignals } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { motion } from "framer-motion";

export default function Signals() {
  const { data: signals, isLoading } = useGetSignals({ limit: 50 }, { query: { refetchInterval: 5000 } });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
      case 'executed': return 'bg-primary/10 text-primary border-primary/20';
      case 'expired': return 'bg-muted/10 text-muted-foreground border-border';
      case 'rejected': return 'bg-destructive/10 text-destructive border-destructive/20';
      default: return 'bg-secondary text-muted-foreground';
    }
  };

  return (
    <Shell>
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-white">Trading Signals</h2>
        <p className="text-muted-foreground font-mono text-sm mt-1">Algorithmic edges detected in real-time</p>
      </div>

      <Card className="bg-card border-border overflow-hidden">
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-secondary/50">
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="font-mono text-xs text-muted-foreground">Time</TableHead>
                <TableHead className="font-mono text-xs text-muted-foreground">Market</TableHead>
                <TableHead className="font-mono text-xs text-muted-foreground">Strategy</TableHead>
                <TableHead className="font-mono text-xs text-muted-foreground text-center">Direction</TableHead>
                <TableHead className="font-mono text-xs text-muted-foreground text-right">Edge</TableHead>
                <TableHead className="font-mono text-xs text-muted-foreground text-right">Confidence</TableHead>
                <TableHead className="font-mono text-xs text-muted-foreground text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground font-mono">Loading signals...</TableCell>
                </TableRow>
              ) : !signals?.length ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground font-mono">No signals generated yet</TableCell>
                </TableRow>
              ) : (
                signals.map((signal, i) => (
                  <motion.tr 
                    key={signal.id} 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.05, 0.5) }}
                    className="border-border hover:bg-secondary/20 transition-colors"
                  >
                    <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                      {formatDate(signal.createdAt)}
                    </TableCell>
                    <TableCell className="font-medium text-white max-w-[200px] truncate" title={signal.marketQuestion}>
                      {signal.marketQuestion}
                      <div className="text-[10px] text-muted-foreground font-mono mt-1 flex gap-2">
                        <span>Price: ${signal.currentPrice.toFixed(3)}</span>
                        <span>Fair: ${signal.fairValueEstimate.toFixed(3)}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs text-muted-foreground">{signal.strategyType}</span>
                      {signal.nbaDataPoint && (
                        <div className="text-[10px] text-primary/70 mt-1 max-w-[150px] truncate" title={signal.nbaDataPoint}>
                          {signal.nbaDataPoint}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className={`font-mono text-[10px] ${signal.direction === 'YES' ? 'text-primary border-primary/50' : 'text-orange-400 border-orange-400/50'}`}>
                        {signal.direction}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-primary">{formatPercent(signal.edge)}</TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">{formatPercent(signal.confidence)}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant="outline" className={`font-mono text-[10px] ${getStatusColor(signal.status)}`}>
                        {signal.status.toUpperCase()}
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
