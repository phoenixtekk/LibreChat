import { Zap } from 'lucide-react';
import { useLocalize } from '~/hooks';

/** Subtle pill rendered under tool-call results in the main chat to
 *  indicate the code execution actually ran on the Hermes runtime
 *  (gVisor sandbox) rather than the LibreChat paid Code API.
 *
 *  This is the user-facing answer to "how do I know I'm running on
 *  Hermes?" — they see a small "via Hermes" tag below the output. */
export default function ViaHermesPill() {
  const localize = useLocalize();
  return (
    <div className="atk-via-hermes-row">
      <span
        className="atk-via-hermes-pill"
        title={localize('com_atk_via_hermes_tooltip')}
      >
        <Zap size={10} aria-hidden="true" />
        <span>{localize('com_atk_via_hermes')}</span>
      </span>
    </div>
  );
}
