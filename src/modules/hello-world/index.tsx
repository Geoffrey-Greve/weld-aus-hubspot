/**
 * hello-world - minimal React island for validating the mount pattern.
 *
 * Usage in HubL:
 *   <div data-wa-module="hello-world" data-props='{"message":"Hello!","memberTier":"corporate_gold"}'></div>
 *   <script type="module" src="{{ get_asset_url('../assets/js/hello-world.<hash>.js') }}"></script>
 */

import React from 'react'
import mountReactIsland from '@shared/mount'

interface HelloWorldProps {
  message?: string
  memberTier?: string
}

function HelloWorld({ message, memberTier }: HelloWorldProps): React.ReactElement {
  return (
    <div className="wa-hello-world">
      <p>{message ?? 'Hello from Weld Australia React island!'}</p>
      {memberTier && (
        <p className="wa-hello-world__tier">
          Member tier: <strong>{memberTier}</strong>
        </p>
      )}
    </div>
  )
}

mountReactIsland('hello-world', HelloWorld)
