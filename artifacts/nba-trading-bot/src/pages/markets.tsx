import { Shell } from "@/components/layout/Shell";
import { formatMoney } from "@/lib/format";
import { useGetMarkets } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { motion } from "framer-motion";

export default function Markets() {
  const { data: markets, isLoading } = useGetMarkets({}, { query: { refetchInterval: 10000 } });

  const getMarketTypeColor = (type: string) => {
    switch (type) {
      case 'game_winner': return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
      case 'series_winner': return 'bg-purple-500/10 text-purple-400 border-purple-500/20';
      case 'champion': return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
      case 'conference': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      default: return 'bg-secondary text-muted-foreground';
    }
  };

  return (
    <Shell>
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-white">Tracked Markets</h2>
        <p className="text-muted-foreground font-mono text-sm mt-1">Live order book data from Polymarket</p>
      </div>

      <Card className="bg-card border-border overflow-hidden">
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-secondary/50">
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="font-mono text-xs text-muted-foreground">Market / Question</TableHead>
                <TableHead className="font-mono text-xs text-muted-foreground">Type</TableHead>
                <TableHead className="font-mono text-xs text-muted-foreground text-right">Yes Price</TableHead>
                <TableHead className="font-mono text-xs text-muted-foreground text-right">No Price</TableHead>
                <TableHead className="font-mono text-xs text-muted-foreground text-right">Volume</TableHead>
                <TableHead className="font-mono text-xs text-muted-foreground text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground font-mono">Loading market data...</TableCell>
                </TableRow>
              ) : !markets?.length ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground font-mono">No active markets tracked</TableCell>
                </TableRow>
              ) : (
                markets.map((market, i) => (
                  <motion.tr 
                    key={market.id} 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="border-border hover:bg-secondary/20 transition-colors group"
                  >
                    <TableCell className="font-medium text-white max-w-xs truncate" title={market.question}>
                      {market.question}
                      <div className="text-xs text-muted-foreground font-mono mt-1 flex gap-2">
                        <span>{market.teamA}</span>
                        {market.teamB && <span>vs {market.teamB}</span>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`font-mono text-[10px] ${getMarketTypeColor(market.marketType)}`}>
                        {market.marketType.replace('_', ' ').toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-primary">${market.yesPrice.toFixed(3)}</TableCell>
                    <TableCell className="text-right font-mono text-orange-400">${market.noPrice.toFixed(3)}</TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">{formatMoney(market.volume)}</TableCell>
                    <TableCell className="text-right">
                      {market.isActive ? (
                        <Badge variant="outline" className="font-mono text-[10px] bg-primary/10 text-primary border-primary/20">ACTIVE</Badge>
                      ) : (
                        <Badge variant="outline" className="font-mono text-[10px] bg-muted/10 text-muted-foreground border-border">CLOSED</Badge>
                      )}
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
