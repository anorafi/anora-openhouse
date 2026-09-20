import type { Address } from "viem";
import { useAccount } from "wagmi";
import { AddressLink } from "./AddressLink";
import { StatusBadge } from "./StatusBadge";
import { useDeployment } from "../hooks/useDeployment";
import { useAllFacilityAddresses } from "../hooks/useFactory";
import { useFacilities } from "../hooks/useFacilities";
import { useMyPositions } from "../hooks/usePositions";
import { toPct, valueShares } from "../lib/facility";
import { formatUsdc } from "../lib/format";

export function Portfolio({
  notice,
  onView,
  onActivity,
}: {
  notice: string | null;
  onView: (facility: Address) => void;
  onActivity: () => void;
}) {
  const { address, isConnected } = useAccount();
  const deployment = useDeployment();
  const { data: addresses } = useAllFacilityAddresses();
  const { facilities } = useFacilities(addresses);
  const { positions } = useMyPositions(addresses, address);

  const rows = facilities
    .map((facility) => {
      const position = positions.get(facility.address) ?? { seniorShares: 0n, juniorShares: 0n };
      const seniorValue = valueShares(position.seniorShares, facility.seniorTotalShares, facility.seniorAssets);
      const juniorValue = valueShares(position.juniorShares, facility.juniorTotalShares, facility.juniorAssets);
      return { facility, position, seniorValue, juniorValue, total: seniorValue + juniorValue };
    })
    .filter((row) => row.position.seniorShares > 0n || row.position.juniorShares > 0n);

  const totalValue = rows.reduce((sum, row) => sum + row.total, 0n);

  if (!isConnected || !address) {
    return (
      <section className="portfolio-page">
        <div className="page-title">
          <h1>Portfolio</h1>
          <p>Track your capital across facilities.</p>
        </div>
        <p className="muted">Connect a wallet to see your positions.</p>
      </section>
    );
  }

  return (
    <section className="portfolio-page">
      <div className="page-title">
        <h1>Portfolio</h1>
        <p>Your capital across every facility, valued live from onchain shares.</p>
      </div>
      {notice && <p className="success-banner">✓ {notice}</p>}
      <dl className="portfolio-summary">
        <div>
          <dt>Total value</dt>
          <dd>
            {formatUsdc(totalValue)} {deployment?.assetSymbol}
          </dd>
        </div>
        <div>
          <dt>Positions</dt>
          <dd>{rows.length}</dd>
        </div>
      </dl>
      <div className="analytics-grid">
        <section className="allocation-panel">
          <header className="panel-heading">
            <div>
              <h2>Allocation</h2>
              <p>Share of your current position value by facility.</p>
            </div>
          </header>
          {rows.length === 0 && <p className="muted">No positions yet.</p>}
          {rows.map((row) => (
            <div className="allocation-row" key={row.facility.address}>
              <span>{row.facility.name}</span>
              <progress max="100" value={totalValue === 0n ? 0 : toPct(row.total, totalValue)} />
              <strong>{totalValue === 0n ? "0" : toPct(row.total, totalValue)}%</strong>
            </div>
          ))}
        </section>
        <section className="positions-panel">
          <header className="panel-heading">
            <div>
              <h2>Your positions</h2>
              <p>All of your facility positions in one place.</p>
            </div>
            <button className="text-button" onClick={onActivity}>View activity →</button>
          </header>
          <div className="positions-table">
            <div className="table-head">
              <span>Facility</span>
              <span>Senior shares</span>
              <span>Junior shares</span>
              <span>Value</span>
              <span>Status</span>
              <span>Action</span>
            </div>
            {rows.map((row) => (
              <div className="table-row" key={row.facility.address}>
                <span>{row.facility.name}</span>
                <span>{formatUsdc(row.position.seniorShares)}</span>
                <span>{formatUsdc(row.position.juniorShares)}</span>
                <span>{formatUsdc(row.total)}</span>
                <span>
                  <StatusBadge status={row.facility.statusName} />
                </span>
                <button onClick={() => onView(row.facility.address)}>View →</button>
              </div>
            ))}
          </div>
        </section>
      </div>
      <p className="portfolio-disclaimer">
        Values are live pro rata against each facility's tranche assets and shares; they change as facilities are drawn down, repaid, or
        default. See <AddressLink address={deployment!.factory} /> for the factory contract.
      </p>
    </section>
  );
}
