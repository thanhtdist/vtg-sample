// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as chai from 'chai';

import DataMessage from '../../src/datamessage/DataMessage';
import NoOpMediaStreamBroker from '../../src/mediastreambroker/NoOpMediaStreamBroker';
import DefaultRealtimeController from '../../src/realtimecontroller/DefaultRealtimeController';
import {
  SdkTranscriptEvent,
  SdkTranscriptFrame,
  SdkTranscriptionStatus,
} from '../../src/signalingprotocol/SignalingProtocol';
import DefaultTranscriptionController, {
  TRANSCRIPTION_DATA_MESSAGE_TOPIC,
} from '../../src/transcript/DefaultTranscriptionController';
import TranscriptEvent from '../../src/transcript/TranscriptEvent';
import TranscriptionController from '../../src/transcript/TranscriptionController';
import TranscriptionStatus from '../../src/transcript/TranscriptionStatus';
import TranscriptionStatusType from '../../src/transcript/TranscriptionStatusType';

function makeTranscriptDataMessage(): DataMessage {
  const status = SdkTranscriptionStatus.create();
  status.type = SdkTranscriptionStatus.Type.STARTED;
  status.eventTime = Date.now();
  status.message = 'message';
  status.transcriptionRegion = 'us-east-1';
  status.transcriptionConfiguration = '{"EngineTranscribeSettings":{"LanguageCode":"en-US"}}';

  const transcriptEvent = SdkTranscriptEvent.create();
  transcriptEvent.status = status;

  const transcriptFrame = SdkTranscriptFrame.create();
  transcriptFrame.events = [transcriptEvent];

  return new DataMessage(
    10000,
    TRANSCRIPTION_DATA_MESSAGE_TOPIC,
    SdkTranscriptFrame.encode(transcriptFrame).finish(),
    '',
    ''
  );
}

describe('DefaultTranscriptionController', () => {
  const assert: Chai.AssertStatic = chai.assert;
  const expect: Chai.ExpectStatic = chai.expect;

  describe('construction', () => {
    it('can be constructed', () => {
      const transcriptionController: TranscriptionController = new DefaultTranscriptionController(
        new DefaultRealtimeController(new NoOpMediaStreamBroker())
      );
      expect(transcriptionController).to.not.equal(null);
    });
  });

  describe('transcript event callbacks', () => {
    it('all callbacks can receive transcript event if subscribed', () => {
      const realtimeController = new DefaultRealtimeController(new NoOpMediaStreamBroker());
      const transcriptionController: TranscriptionController = new DefaultTranscriptionController(
        realtimeController
      );
      let resultTranscriptEvent1: TranscriptEvent = null;
      let resultTranscriptEvent2: TranscriptEvent = null;
      const callback1 = (transcriptEvent: TranscriptEvent): void => {
        resultTranscriptEvent1 = transcriptEvent;
      };
      const callback2 = (transcriptEvent: TranscriptEvent): void => {
        resultTranscriptEvent2 = transcriptEvent;
      };
      transcriptionController.subscribeToTranscriptEvent(callback1);
      transcriptionController.subscribeToTranscriptEvent(callback2);
      realtimeController.realtimeReceiveDataMessage(makeTranscriptDataMessage());
      expect(resultTranscriptEvent1).to.not.be.null;
      if (!(resultTranscriptEvent1 instanceof TranscriptionStatus)) {
        assert.fail();
        return;
      }

      expect(resultTranscriptEvent1.type).to.eq(TranscriptionStatusType.STARTED);
      expect(resultTranscriptEvent1.message).to.eq('message');
      expect(resultTranscriptEvent1.transcriptionRegion).to.eq('us-east-1');
      expect(resultTranscriptEvent1.transcriptionConfiguration).to.eq(
        '{"EngineTranscribeSettings":{"LanguageCode":"en-US"}}'
      );

      expect(resultTranscriptEvent2).to.not.be.null;
    });

    it('will not receive transcript event if unsubscribed', () => {
      const realtimeController = new DefaultRealtimeController(new NoOpMediaStreamBroker());
      const transcriptionController: TranscriptionController = new DefaultTranscriptionController(
        realtimeController
      );
      let callbackFired = false;
      let resultTranscriptEvent: TranscriptEvent = null;
      const callback = (transcriptEvent: TranscriptEvent): void => {
        callbackFired = true;
        resultTranscriptEvent = transcriptEvent;
      };
      transcriptionController.subscribeToTranscriptEvent(callback);
      transcriptionController.unsubscribeFromTranscriptEvent(callback);
      realtimeController.realtimeReceiveDataMessage(makeTranscriptDataMessage());
      expect(callbackFired).to.equal(false);
      expect(resultTranscriptEvent).to.be.null;
    });

    it('will not affect other callbacks if one callback is unsubscribed', () => {
      const realtimeController = new DefaultRealtimeController(new NoOpMediaStreamBroker());
      const transcriptionController: TranscriptionController = new DefaultTranscriptionController(
        realtimeController
      );
      let callbackFired = false;
      let resultTranscriptEvent: TranscriptEvent = null;
      const callback1 = (transcriptEvent: TranscriptEvent): void => {
        resultTranscriptEvent = transcriptEvent;
      };
      const callback2 = (transcriptEvent: TranscriptEvent): void => {
        callbackFired = true;
        resultTranscriptEvent = transcriptEvent;
      };
      transcriptionController.subscribeToTranscriptEvent(callback1);
      transcriptionController.subscribeToTranscriptEvent(callback2);
      transcriptionController.unsubscribeFromTranscriptEvent(callback1);
      realtimeController.realtimeReceiveDataMessage(makeTranscriptDataMessage());
      expect(callbackFired).to.equal(true);
      expect(resultTranscriptEvent).to.not.be.null;
    });
  });
});
