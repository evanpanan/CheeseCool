import { CheeseMark } from '../icons';

export function NetworkHeading() {
  return <header className="network-heading atlas-heading">
    <div className="atlas-mark"><CheeseMark size={34}/></div>
    <div>
      <h1>芝士网络</h1>
      <p>点开一块奶酪，沿着连线继续探索。</p>
    </div>
  </header>;
}
