using NotesSample.Infrastructure.Notifications;
using Shouldly;
using Xunit;

namespace NotesSample.UnitTests.Infrastructure.Notifications;

public sealed class ChangeNotificationsTests
{
    public sealed class Subscribe
    {
        [Fact]
        public void ReturnsDisposableSubscription()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var changes = new ChangeNotifications(_ => { });

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var subscription = changes.Subscribe("alice", () => { });

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            subscription.ShouldBeAssignableTo<IDisposable>();
            subscription.Dispose();
        }
    }

    public sealed class Publish
    {
        [Fact]
        public void UnknownOwner_DoesNothing()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var reportedErrors = 0;
            var changes = new ChangeNotifications(_ => reportedErrors++);

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var error = Record.Exception(() => changes.Publish("missing"));

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            error.ShouldBeNull();
            reportedErrors.ShouldBe(0);
        }
    }

    [Fact]
    public void RegistersListenerForOwner()
    {
        // -------------------------------------------------------------
        // Arrange
        // -------------------------------------------------------------
        var changes = new ChangeNotifications(_ => { });
        var calls = 0;

        // -------------------------------------------------------------
        // Act
        // -------------------------------------------------------------
        using var subscription = changes.Subscribe("alice", () => calls++);
        changes.Publish("alice");

        // -------------------------------------------------------------
        // Assert
        // -------------------------------------------------------------
        calls.ShouldBe(1);
    }

    [Fact]
    public void DisposingReturnedSubscription_RemovesListener()
    {
        // -------------------------------------------------------------
        // Arrange
        // -------------------------------------------------------------
        var changes = new ChangeNotifications(_ => { });
        var calls = 0;
        var subscription = changes.Subscribe("alice", () => calls++);

        // -------------------------------------------------------------
        // Act
        // -------------------------------------------------------------
        subscription.Dispose();
        changes.Publish("alice");

        // -------------------------------------------------------------
        // Assert
        // -------------------------------------------------------------
        calls.ShouldBe(0);
    }

    [Fact]
    public void DisposingReturnedSubscriptionTwice_IsIdempotent()
    {
        // -------------------------------------------------------------
        // Arrange
        // -------------------------------------------------------------
        var changes = new ChangeNotifications(_ => { });
        var subscription = changes.Subscribe("alice", () => { });

        // -------------------------------------------------------------
        // Act
        // -------------------------------------------------------------
        var error = Record.Exception(() =>
        {
            subscription.Dispose();
            subscription.Dispose();
        });

        // -------------------------------------------------------------
        // Assert
        // -------------------------------------------------------------
        error.ShouldBeNull();
    }

    [Fact]
    public void DifferentOwners_AreIsolated()
    {
        // -------------------------------------------------------------
        // Arrange
        // -------------------------------------------------------------
        var changes = new ChangeNotifications(_ => { });
        var aliceCalls = 0;
        var bobCalls = 0;
        using var aliceSubscription = changes.Subscribe("alice", () => aliceCalls++);
        using var bobSubscription = changes.Subscribe("bob", () => bobCalls++);

        // -------------------------------------------------------------
        // Act
        // -------------------------------------------------------------
        changes.Publish("alice");

        // -------------------------------------------------------------
        // Assert
        // -------------------------------------------------------------
        aliceCalls.ShouldBe(1);
        bobCalls.ShouldBe(0);
    }

    [Fact]
    public void ListenerExceptions_AreReportedAndDoNotStopOtherListeners()
    {
        // -------------------------------------------------------------
        // Arrange
        // -------------------------------------------------------------
        var reportedErrors = new List<Exception>();
        var changes = new ChangeNotifications(reportedErrors.Add);
        var expected = new InvalidOperationException("listener failed");
        var successfulCalls = 0;
        using var failingSubscription = changes.Subscribe("alice", () => throw expected);
        using var successfulSubscription = changes.Subscribe("alice", () => successfulCalls++);

        // -------------------------------------------------------------
        // Act
        // -------------------------------------------------------------
        var error = Record.Exception(() => changes.Publish("alice"));

        // -------------------------------------------------------------
        // Assert
        // -------------------------------------------------------------
        error.ShouldBeNull();
        reportedErrors.ShouldHaveSingleItem().ShouldBeSameAs(expected);
        successfulCalls.ShouldBe(1);
    }

    [Fact]
    public void PublishUsesSnapshot_WhenListenerDisposesItsSubscription()
    {
        // -------------------------------------------------------------
        // Arrange
        // -------------------------------------------------------------
        var changes = new ChangeNotifications(_ => { });
        var calls = 0;
        IDisposable? subscription = null;
        subscription = changes.Subscribe("alice", () =>
        {
            calls++;
            subscription!.Dispose();
        });

        // -------------------------------------------------------------
        // Act
        // -------------------------------------------------------------
        var firstError = Record.Exception(() => changes.Publish("alice"));
        var secondError = Record.Exception(() => changes.Publish("alice"));

        // -------------------------------------------------------------
        // Assert
        // -------------------------------------------------------------
        firstError.ShouldBeNull();
        secondError.ShouldBeNull();
        calls.ShouldBe(1);
    }
}
