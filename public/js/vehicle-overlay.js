(function (root) {
  'use strict';

  function createVehicleOverlayHelpers(prefix, { respectTargetVisibility = false } = {}) {
    function getVehicleOverlayNodeId(targetNodeId) {
      return `${prefix}${targetNodeId}`;
    }

    function syncVehicleOverlayPositions(cy) {
      if (!cy) {
        return;
      }
      cy.nodes('.vehicle-overlay').forEach(overlayNode => {
        const targetId = overlayNode.data('targetId');
        if (!targetId) {
          return;
        }
        const targetNode = cy.getElementById(targetId);
        if (!targetNode || targetNode.empty()) {
          return;
        }
        if (respectTargetVisibility) {
          const targetHidden = targetNode.style('display') === 'none';
          overlayNode.style('display', targetHidden ? 'none' : 'element');
          if (targetHidden) {
            return;
          }
        }
        overlayNode.unlock();
        overlayNode.position(targetNode.position());
        overlayNode.lock();
      });
    }

    function attachVehicleOverlayPositionFollower(cy, { selector = 'node', ignoreOverlayClass = false } = {}) {
      cy.on('position', selector, event => {
        const node = event.target;
        if (!node || (ignoreOverlayClass && node.hasClass('vehicle-overlay'))) {
          return;
        }
        const overlayNode = cy.getElementById(getVehicleOverlayNodeId(node.id()));
        if (!overlayNode || overlayNode.empty()) {
          return;
        }
        overlayNode.unlock();
        overlayNode.position(node.position());
        overlayNode.lock();
      });
    }

    return {
      getVehicleOverlayNodeId,
      syncVehicleOverlayPositions,
      attachVehicleOverlayPositionFollower
    };
  }

  root.VehicleOverlay = {
    createHelpers: createVehicleOverlayHelpers
  };
})(typeof window !== 'undefined' ? window : globalThis);
