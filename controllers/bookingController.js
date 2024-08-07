const ApiError = require("../utils/apiError");
const processBooking = require("../utils/processBooking");
const cron = require("node-cron");

const {
  Bookings,
  Booking_Details,
  Seats,
  Flights,
  Airports,
  Airlines,
  Notifications,
  Passengers,
  Discounts,
} = require("../models");
const axios = require("axios");
const { Op } = require("sequelize");

const getDetailBooking = async (req, res, next) => {
  try {
    const id = req.user.id;

    if (!id) {
      return next(new ApiError("Please login to your account", 403));
    }

    const {
      flightType,
      bookingCode,
      sortBy,
      order,
      page,
      limit,
      start_date,
      end_date,
    } = req.query;

    const condition = {};
    condition.user_id = id;
    if (bookingCode) condition.booking_code = { [Op.iLike]: `${bookingCode}%` };
    if (flightType) {
      if (flightType === "two-way") {
        condition.return_flight_id = { [Op.not]: null };
      } else if (flightType === "one-way") {
        condition.return_flight_id = { [Op.is]: null };
      }
    }

    if (start_date && end_date) {
      const [startDay, startMonth, startYear] = start_date.split("-");
      const startSpecificDate = new Date(startYear, startMonth - 1, startDay);

      const [endDay, endMonth, endYear] = end_date.split("-");
      const endSpecificDate = new Date(endYear, endMonth - 1, endDay);

      const nextEndDate = new Date(endSpecificDate);
      nextEndDate.setDate(endSpecificDate.getDate() + 1);

      condition.created_at = {
        [Op.gte]: startSpecificDate,
        [Op.lt]: nextEndDate,
      };
    }

    const orderData = [];
    if (sortBy) {
      const sortOrder = order === "asc" ? "ASC" : "DESC";
      if (sortBy === "transactionDate") {
        orderData.push(["created_at", sortOrder]);
      } else if (sortBy === "amount") {
        orderData.push(["total_amount", sortOrder]);
      }
    }

    const pageNum = parseInt(page) || 1;
    const pageSize = parseInt(limit) || 10;
    const offset = (pageNum - 1) * pageSize;

    const totalCount = await Bookings.count({ where: condition });

    const booking = await Bookings.findAll({
      where: condition,
      limit: pageSize,
      offset: offset,
      order: orderData,
      attributes: [
        "booking_code",
        "discount_id",
        "payment_method",
        "payment_id",
        "payment_url",
        "payment_token",
        "ordered_by_first_name",
        "ordered_by_last_name",
        "ordered_by_phone_number",
        "ordered_by_email",
        "total_amount",
        "booking_status",
        "booking_expired",
        "created_at",
      ],

      include: [
        {
          model: Discounts,
          as: "discount",
        },
        {
          model: Flights,
          attributes: [
            "id",
            "price_economy",
            "price_premium_economy",
            "price_business",
            "price_first_class",
            "flight_number",
            "information",
            "departure_time",
            "arrival_time",
            "departure_terminal",
          ],
          as: "flight",
          include: [
            {
              model: Airlines,
              as: "airline",
              attributes: ["airline_name", "airline_picture"],
            },
            {
              model: Airports,
              as: "departureAirport",
              attributes: [
                "airport_name",
                "airport_city",
                "airport_city_code",
                "airport_picture",
                "airport_continent",
              ],
            },
            {
              model: Airports,
              as: "arrivalAirport",
              attributes: [
                "airport_name",
                "airport_city",
                "airport_city_code",
                "airport_picture",
                "airport_continent",
              ],
            },
          ],
        },
        {
          model: Flights,
          attributes: [
            "id",
            "price_economy",
            "price_premium_economy",
            "price_business",
            "price_first_class",
            "flight_number",
            "information",
            "departure_time",
            "arrival_time",
            "departure_terminal",
          ],
          as: "returnFlight",
          include: [
            {
              model: Airlines,
              as: "airline",
              attributes: ["airline_name", "airline_picture"],
            },
            {
              model: Airports,
              as: "departureAirport",
              attributes: [
                "airport_name",
                "airport_city",
                "airport_city_code",
                "airport_picture",
                "airport_continent",
              ],
            },
            {
              model: Airports,
              as: "arrivalAirport",
              attributes: [
                "airport_name",
                "airport_city",
                "airport_city_code",
                "airport_picture",
                "airport_continent",
              ],
            },
          ],
        },
        {
          model: Booking_Details,
          as: "bookingDetail",
          attributes: ["price"],
          include: [
            {
              model: Seats,
              as: "seat",
              attributes: ["class", "seat_name"],
            },
            {
              model: Passengers,
              as: "passenger",
            },
          ],
        },
      ],
    });

    if (!booking) {
      return next(new ApiError("Booking not found", 404));
    }

    booking.forEach((bookingItem) => {
      const flight = bookingItem.flight;
      if (flight) {
        const departureTime = new Date(flight.departure_time);
        const arrivalTime = new Date(flight.arrival_time);
        const duration = (arrivalTime - departureTime) / 60000; // duration in minutes
        const jam = Math.floor(duration / 60);
        const menit = duration % 60;
        const formattedDurasi = `${jam}h ${menit}m`;
        bookingItem.dataValues.duration = formattedDurasi;
      } else {
        bookingItem.dataValues.duration = "N/A";
      }

      const uniqueClasses = new Set(
        bookingItem.bookingDetail.map((detail) => detail.seat.class)
      );
      bookingItem.dataValues.classes = Array.from(uniqueClasses).join(", ");
    });

    const totalPages = Math.ceil(totalCount / pageSize);
    res.status(200).json({
      status: "Success",
      message: "Booking data is successfully retrieved",
      requestAt: req.requestTime,
      pagination: {
        totalData: totalCount,
        totalPages,
        pageNum,
        pageSize,
      },
      data: {
        booking,
      },
    });
  } catch (err) {
    return next(new ApiError(err.message, 400));
  }
};

const createBooking = async (req, res, next) => {
  try {
    const userId = req.user.id;

    if (!userId) {
      return next(new ApiError("Booking error, Please login!", 400));
    }

    const booking = await processBooking(req.body, userId);

    const bookingCode = booking.booking.booking_code;

    await Notifications.create({
      notification_type: "Notification",
      notification_title: `Order Status ${bookingCode}`,
      notification_description: `Your order with Booking Code : ${bookingCode} is wating for payment. Please make a payment to confirm your order.`,
      user_id: userId,
    });

    res.status(201).json({
      status: "Success",
      message: "Booking is created successfully",
      data: booking,
    });
  } catch (err) {
    return next(new ApiError(err.message, 400));
  }
};

const cancelBooking = async (req, res, next) => {
  try {
    const user_id = req.user.id;
    const booking_code = req.params.bookingCode;

    // Cek apakah booking id  ada?
    const bookingData = await Bookings.findOne({
      where: {
        booking_code: booking_code,
      },
    });

    if (!bookingData) {
      return next(new ApiError("Booking not found", 404));
    }

    // Kalo token tidak sesuai dengan user id yang berada di booking code maka gagal
    if (bookingData.user_id !== user_id) {
      return next(
        new ApiError("Cannot cancel booking, this is not your booking", 400)
      );
    }

    // Kalo status bukan unpaid maka gagal
    if (bookingData.booking_status !== "unpaid") {
      return next(
        new ApiError(`Booking is already ${bookingData.booking_status}`, 400)
      );
    }

    // If status payment is not success
    const booking = await Bookings.update(
      {
        booking_status: "cancelled",
      },
      {
        where: {
          booking_code: booking_code,
        },
      }
    );

    if (!booking) {
      return next(new ApiError("Booking not found", 404));
    }

    const getBookingId = await Bookings.findOne({
      where: {
        booking_code: booking_code,
      },
    });

    const bookingDetails = await Booking_Details.findAll({
      where: {
        booking_id: getBookingId.id,
      },
    });

    const seatIds = await bookingDetails.map((detail) => detail.seat_id);

    // Update seat to available
    await Seats.update(
      {
        seat_status: "available",
      },
      {
        where: { id: seatIds },
      }
    );

    await Notifications.create({
      notification_type: "Notification",
      notification_title: `Order Status ${booking_code} is Cancelled`,
      notification_description: `Your order with Booking Code : ${booking_code} has been cancelled. Please check your ticket details on the order history page or contact us at airseat.mailsystem@gmail.com.`,
      user_id: user_id,
    });

    res.status(200).json({
      status: "Success",
      message: "Booking is succesfully cancelled",
      requestAt: req.requestTime,
    });
  } catch (err) {
    return next(new ApiError(err.message, 400));
  }
};

const updateBookingStatus = async (req, res, next) => {
  try {
    const { transaction_status, order_id, transaction_id } = req.body;

    if (transaction_status) {
      if (
        transaction_status === "capture" ||
        transaction_status === "settlement"
      ) {
        // If status payment is success
        const booking = await Bookings.update(
          {
            booking_status: "issued",
          },
          {
            where: {
              booking_code: order_id,
            },
          }
        );

        if (!booking) {
          return next(new ApiError("Booking not found", 404));
        }

        const getBookingId = await Bookings.findOne({
          where: {
            booking_code: order_id,
          },
        });

        const bookingDetails = await Booking_Details.findAll({
          where: {
            booking_id: getBookingId.id,
          },
        });

        const seatIds = await bookingDetails.map((detail) => detail.seat_id);

        // Update seat to unavailbale
        await Seats.update(
          {
            seat_status: "unavailable",
          },
          {
            where: { id: seatIds },
          }
        );

        await Notifications.create({
          notification_type: "Notification",
          notification_title: `Order Status ${order_id}`,
          notification_description: `Your order with Booking Code : ${order_id} has been successfully paid. Please check your ticket details on the order history page or contact us at airseat.mailsystem@gmail.com.`,
          user_id: getBookingId.user_id,
        });

        res.status(200).json({
          status: "Success",
          message: `Booking for ${order_id} Status is successfully issued`,
          requestAt: req.requestTime,
        });
      } else if (transaction_status === "pending") {
        // If status payment is pending
        const booking = await Bookings.findOne({
          booking_code: order_id,
        });

        if (!booking) {
          return next(new ApiError("Booking not found", 404));
        }

        const bookingUpdate = await Bookings.update(
          {
            payment_id: transaction_id,
          },
          {
            where: {
              booking_code: order_id,
            },
          }
        );

        if (!bookingUpdate) {
          return next(
            new ApiError("Unexpected error, status not updated", 400)
          );
        }

        res.status(200).json({
          status: "Success",
          message: `Booking for ${order_id} Status is pending`,
        });
      } else if (
        transaction_status === "deny" ||
        transaction_status === "expire" ||
        transaction_status === "cancel" ||
        transaction_status === "expire" ||
        transaction_status === "failure"
      ) {
        // If status payment is not success
        const booking = await Bookings.update(
          {
            booking_status: "cancelled",
          },
          {
            where: {
              booking_code: order_id,
            },
          }
        );

        if (!booking) {
          return next(new ApiError("Booking not found", 404));
        }

        const getBookingId = await Bookings.findOne({
          where: {
            booking_code: order_id,
          },
        });

        const bookingDetails = await Booking_Details.findAll({
          where: {
            booking_id: getBookingId.id,
          },
        });

        const seatIds = await bookingDetails.map((detail) => detail.seat_id);

        // Update seat to available
        await Seats.update(
          {
            seat_status: "available",
          },
          {
            where: { id: seatIds },
          }
        );

        if (transaction_status === "deny") {
          await Notifications.create({
            notification_type: "Notification",
            notification_title: `Order Status ${order_id}`,
            notification_description: `Your order with Booking Code : ${order_id} has been rejected. Please check your ticket details on the order history page or contact us at airseat.mailsystem@gmail.com.`,
            user_id: getBookingId.user_id,
          });
        } else if (transaction_status === "expire") {
          await Notifications.create({
            notification_type: "Notification",
            notification_title: `Order Status ${order_id}`,
            notification_description: `Your order with Booking Code : ${order_id} has been expired. Please check your ticket details on the order history page or contact us at airseat.mailsystem@gmail.com.`,
            user_id: getBookingId.user_id,
          });
        } else if (transaction_status === "cancel") {
          await Notifications.create({
            notification_type: "Notification",
            notification_title: `Order Status ${order_id}`,
            notification_description: `Your order with Booking Code : ${order_id} has been cancelled. Please check your ticket details on the order history page or contact us at airseat.mailsystem@gmail.com.`,
            user_id: getBookingId.user_id,
          });
        } else if (transaction_status === "failure") {
          await Notifications.create({
            notification_type: "Notification",
            notification_title: `Order Status ${order_id}`,
            notification_description: `Your order with Booking Code : ${order_id} is failed. Please check your ticket details on the order history page or contact us at airseat.mailsystem@gmail.com.`,
            user_id: getBookingId.user_id,
          });
        }

        res.status(200).json({
          status: "Success",
          message: `Booking for ${order_id} Status is successfully canceled`,
          requestAt: req.requestTime,
        });
      } else {
        // If status payment is unexpected
        throw new Error("No status");
      }
    }
  } catch (err) {
    return next(new ApiError(err.message, 400));
  }
};

cron.schedule("30 * * * *", () => {
  updateWorker();
});

const updateWorker = async (req, res, next) => {
  try {
    const bookingToUpdate = await Bookings.findAll({
      where: {
        booking_status: "unpaid",
        booking_expired: {
          [Op.lte]: new Date(),
        },
      },
    });

    if (bookingToUpdate.length > 0) {
      // Cancel order
      for (let booking of bookingToUpdate) {
        await processCancelBooking(booking.booking_code, booking.user_id);
      }
    }
  } catch (err) {
    return next(new ApiError(err.message, 400));
  }
};

const processCancelBooking = async (order_id, user_id) => {
  try {
    const booking = await Bookings.update(
      {
        booking_status: "cancelled",
      },
      {
        where: {
          booking_code: order_id,
        },
      }
    );

    if (!booking) {
      throw new Error("Booking not found");
    }

    const getBookingId = await Bookings.findOne({
      where: {
        booking_code: order_id,
      },
    });

    const bookingDetails = await Booking_Details.findAll({
      where: {
        booking_id: getBookingId.id,
      },
    });

    const seatIds = await bookingDetails.map((detail) => detail.seat_id);

    // Update seat to available
    await Seats.update(
      {
        seat_status: "available",
      },
      {
        where: { id: seatIds },
      }
    );

    await Notifications.create({
      notification_type: "Notification",
      notification_title: `Order Status ${order_id} is Expired`,
      notification_description: `Your order with Booking Code : ${order_id} has been expired. Please check your ticket details on the order history page or contact us at airseat.mailsystem@gmail.com.`,
      user_id: user_id,
    });
  } catch (err) {
    throw new Error(err.message);
  }
};

const getPaymentStatus = async (req, res, next) => {
  try {
    const { bookingCode } = req.params;

    const booking = await Bookings.findOne({
      where: {
        booking_code: bookingCode,
      },
    });

    if (!booking) {
      return next(new ApiError("Booking code not found", 404));
    }

    const encodedServerKey = Buffer.from(
      process.env.MIDTRANS_SERVER_KEY + ":"
    ).toString("base64");

    const options = {
      method: "GET",
      url: `https://api.sandbox.midtrans.com/v2/${bookingCode}/status`,
      headers: {
        accept: "application/json",
        authorization: `Basic ${encodedServerKey}`,
      },
    };

    const response = await axios.request(options);

    res.status(200).json({
      status: "Success",
      message: "Transaction status retrieved",
      requestAt: req.requestTime,
      data: {
        transaction_status: response.data,
      },
    });
  } catch (err) {
    return next(new ApiError(err.message, 400));
  }
};

module.exports = {
  createBooking,
  getPaymentStatus,
  updateBookingStatus,
  getDetailBooking,
  cancelBooking,
  updateWorker,
};
