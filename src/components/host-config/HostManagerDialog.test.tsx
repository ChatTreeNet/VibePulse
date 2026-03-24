import * as React from 'react';
import * as tlReact from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { HostManagerDialog } from './HostManagerDialog';
import { useHostSources } from '@/hooks/useHostSources';

const noop = () => {
};
type Screen = {
    getByTestId: (testId: string) => HTMLElement;
    queryByRole: (role: string, options?: { name?: RegExp | string }) => HTMLElement | null;
    getByRole: (role: string, options?: { name?: RegExp | string }) => HTMLElement;
    getByText: (text: RegExp | string) => HTMLElement;
    queryByTestId: (testId: string) => HTMLElement | null;
};
type RenderFn = (ui: React.ReactElement) => unknown;
type WithinFn = (element: HTMLElement) => {
    queryByRole: (role: string, options?: { name?: RegExp | string }) => HTMLElement | null;
    getByRole: (role: string, options?: { name?: RegExp | string }) => HTMLElement;
};

const { render, screen, within } = tlReact as unknown as {
    render: RenderFn;
    screen: Screen;
    within: WithinFn;
};

let mockAddRemoteHostCalls: unknown[][] = [];
let mockEditRemoteHostCalls: unknown[][] = [];
let mockDeleteRemoteHostCalls: unknown[][] = [];
let mockToggleRemoteHostCalls: unknown[][] = [];

type HostSourcesState = ReturnType<typeof useHostSources>;

function createHostSourcesState(): HostSourcesState {
    return {
        sources: [
            { hostId: 'local', hostLabel: 'Local', hostKind: 'local' },
            { hostId: 'remote-1', hostLabel: 'Test Remote', hostKind: 'remote', baseUrl: 'http://test.com', enabled: true },
            { hostId: 'remote-2', hostLabel: 'Another Remote', hostKind: 'remote', baseUrl: 'http://another.com', enabled: false },
        ],
        enabledSources: [
            { hostId: 'local', hostLabel: 'Local', hostKind: 'local' },
            { hostId: 'remote-1', hostLabel: 'Test Remote', hostKind: 'remote', baseUrl: 'http://test.com', enabled: true },
        ],
        remoteHosts: [
            { hostId: 'remote-1', hostLabel: 'Test Remote', baseUrl: 'http://test.com', enabled: true },
            { hostId: 'remote-2', hostLabel: 'Another Remote', baseUrl: 'http://another.com', enabled: false },
        ],
        activeFilter: 'all',
        activeSource: null,
        filteredHostIds: null,
        setActiveFilter: () => {},
        addRemoteHost: async (...args: unknown[]) => { mockAddRemoteHostCalls.push(args); },
        editRemoteHost: async (...args: unknown[]) => { mockEditRemoteHostCalls.push(args); },
        deleteRemoteHost: async (...args: unknown[]) => { mockDeleteRemoteHostCalls.push(args); },
        toggleRemoteHost: async (...args: unknown[]) => { mockToggleRemoteHostCalls.push(args); },
        isLoading: false,
        error: null,
    };
}

describe('HostManagerDialog', () => {
    let hostSourcesState: HostSourcesState;

    beforeEach(() => {
        mockAddRemoteHostCalls = [];
        mockEditRemoteHostCalls = [];
        mockDeleteRemoteHostCalls = [];
        mockToggleRemoteHostCalls = [];
        hostSourcesState = createHostSourcesState();
    });

    it('renders local row and does not allow editing or deleting local', () => {
        render(<HostManagerDialog open={true} onClose={noop} hostSources={hostSourcesState} />);

        const localRow = screen.getByTestId('host-row-local');
        expect(localRow).toBeTruthy();
        expect(within(localRow).queryByRole('button', { name: /edit/i })).toBeNull();
        expect(within(localRow).queryByRole('button', { name: /delete/i })).toBeNull();
    });

    it('adds a remote node', async () => {
        const user = userEvent.setup();
        render(<HostManagerDialog open={true} onClose={noop} hostSources={hostSourcesState} />);

        await user.click(screen.getByRole('button', { name: /add remote node/i }));

        const labelInput = screen.getByTestId('host-form-label');
        const urlInput = screen.getByTestId('host-form-base-url');
        const tokenInput = screen.getByTestId('host-form-token');

        await user.type(labelInput, 'New Host');
        await user.type(urlInput, 'http://new-host.com');
        await user.type(tokenInput, 'supersecret');

        await user.click(screen.getByRole('button', { name: /add node/i }));

        expect(mockAddRemoteHostCalls.length).toBeGreaterThan(0);
        const addArgs = mockAddRemoteHostCalls[0];
        expect(addArgs).toHaveLength(1);
        const addedHost = addArgs[0] as Record<string, unknown>;
        expect(addedHost.hostLabel).toBe('New Host');
        expect(addedHost.baseUrl).toBe('http://new-host.com');
        expect(addedHost.token).toBe('supersecret');
        expect(addedHost.enabled).toBe(true);
    });

    it('shows optional token warning copy in add form', async () => {
        const user = userEvent.setup();
        render(<HostManagerDialog open={true} onClose={noop} hostSources={hostSourcesState} />);

        await user.click(screen.getByRole('button', { name: /add remote node/i }));

        expect(screen.getByText(/Access Token \(optional\)/i)).toBeTruthy();
        expect(screen.getByText(/Recommended: set a token unless this node is only reachable on a trusted private network\./i)).toBeTruthy();
    });

    it('edits a remote node', async () => {
        const user = userEvent.setup();
        render(<HostManagerDialog open={true} onClose={noop} hostSources={hostSourcesState} />);

        const testRemoteRow = screen.getByTestId('host-row-remote-remote-1');
        await user.click(within(testRemoteRow).getByRole('button', { name: /edit node/i }));

        const labelInput = screen.getByTestId('host-form-label');
        await user.clear(labelInput);
        await user.type(labelInput, 'Updated Host');

        await user.click(within(testRemoteRow).getByRole('button', { name: /save/i }));

        expect(mockEditRemoteHostCalls.length).toBeGreaterThan(0);
        const editArgs = mockEditRemoteHostCalls[0];
        expect(editArgs).toHaveLength(2);
        expect(editArgs[0]).toBe('remote-1');
        expect((editArgs[1] as Record<string, unknown>).hostLabel).toBe('Updated Host');
        expect((editArgs[1] as Record<string, unknown>).baseUrl).toBe('http://test.com');
    });

    it('passes explicit empty token when clearing token on edit', async () => {
        const user = userEvent.setup();
        render(<HostManagerDialog open={true} onClose={noop} hostSources={hostSourcesState} />);

        const testRemoteRow = screen.getByTestId('host-row-remote-remote-1');
        await user.click(within(testRemoteRow).getByRole('button', { name: /edit node/i }));

        await user.click(screen.getByRole('checkbox', { name: /clear saved token on save/i }));

        await user.click(within(testRemoteRow).getByRole('button', { name: /save/i }));

        expect(mockEditRemoteHostCalls.length).toBeGreaterThan(0);
        const editArgs = mockEditRemoteHostCalls[0];
        const editedHost = editArgs[1] as Record<string, unknown>;
        expect(editedHost.token).toBe('');
    });

    it('deletes a remote node', async () => {
        const user = userEvent.setup();
        render(<HostManagerDialog open={true} onClose={noop} hostSources={hostSourcesState} />);

        const testRemoteRow = screen.getByTestId('host-row-remote-remote-1');
        await user.click(within(testRemoteRow).getByRole('button', { name: /delete node/i }));

        expect(mockDeleteRemoteHostCalls.length).toBeGreaterThan(0);
        expect(mockDeleteRemoteHostCalls[0][0]).toBe('remote-1');
    });

    it('toggles a remote node', async () => {
        const user = userEvent.setup();
        render(<HostManagerDialog open={true} onClose={noop} hostSources={hostSourcesState} />);

        const testRemoteRow = screen.getByTestId('host-row-remote-remote-1');
        await user.click(within(testRemoteRow).getByRole('button', { name: /disable/i }));

        expect(mockToggleRemoteHostCalls.length).toBeGreaterThan(0);
        expect(mockToggleRemoteHostCalls[0][0]).toBe('remote-1');
    });

    it('validates URLs on add', async () => {
        const user = userEvent.setup();
        render(<HostManagerDialog open={true} onClose={noop} hostSources={hostSourcesState} />);

        await user.click(screen.getByRole('button', { name: /add remote node/i }));

        const labelInput = screen.getByTestId('host-form-label');
        const urlInput = screen.getByTestId('host-form-base-url');

        await user.type(labelInput, 'Invalid Host');
        await user.type(urlInput, 'not-a-url');

        await user.click(screen.getByRole('button', { name: /add node/i }));

        expect(screen.getByText(/A valid Node URL is required/i)).toBeTruthy();
        expect(mockAddRemoteHostCalls.length).toBe(0);
    });
    
    it('allows blank token on add', async () => {
        const user = userEvent.setup();
        render(<HostManagerDialog open={true} onClose={noop} hostSources={hostSourcesState} />);

        await user.click(screen.getByRole('button', { name: /add remote node/i }));

        const labelInput = screen.getByTestId('host-form-label');
        const urlInput = screen.getByTestId('host-form-base-url');

        await user.type(labelInput, 'New Host');
        await user.type(urlInput, 'http://new-host.com');
        await user.click(screen.getByRole('button', { name: /add node/i }));

        expect(mockAddRemoteHostCalls.length).toBeGreaterThan(0);
        const addArgs = mockAddRemoteHostCalls[0];
        const addedHost = addArgs[0] as Record<string, unknown>;
        expect(addedHost.token).toBe('');
    });

    it('disables controls in node mode', () => {
        render(<HostManagerDialog open={true} onClose={noop} hostSources={hostSourcesState} isNodeMode={true} />);
        
        expect(screen.getByText(/Node Mode Active/i)).toBeTruthy();
        expect(screen.queryByTestId('host-row-local')).toBeNull();
        expect(screen.queryByRole('button', { name: /add remote node/i })).toBeNull();
    });
});
